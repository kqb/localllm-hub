const Database = require('better-sqlite3');
const { readdirSync, existsSync, statSync } = require('fs');
const { join, basename } = require('path');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { parseTranscriptMessages, chunkMessages } = require('./index');

function embeddingToBuffer(embedding) {
  const buffer = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  return buffer;
}

function bufferToEmbedding(buffer) {
  const embedding = [];
  for (let i = 0; i < buffer.length; i += 4) {
    embedding.push(buffer.readFloatLE(i));
  }
  return embedding;
}

function initDb(dbPath) {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      file TEXT NOT NULL,
      start_ts TEXT,
      end_ts TEXT,
      text TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ingest_progress (
      file TEXT PRIMARY KEY,
      last_offset INTEGER NOT NULL DEFAULT 0,
      last_timestamp TEXT,
      chunk_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_chunks(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_file ON chat_chunks(file);
  `);

  return db;
}

/**
 * Ingest a single transcript file incrementally.
 */
async function ingestFile(db, filePath) {
  const fileName = basename(filePath);
  const sessionId = fileName.replace('.jsonl', '');

  // Get progress
  const progress = db.prepare('SELECT * FROM ingest_progress WHERE file = ?').get(filePath);
  const lastOffset = progress?.last_offset || 0;

  const stat = statSync(filePath);
  if (stat.size <= lastOffset) {
    logger.debug(`Skipping ${fileName} — no new data (${stat.size} <= ${lastOffset})`);
    return 0;
  }

  logger.info(`Ingesting ${fileName} from offset ${lastOffset} (file size: ${stat.size})`);

  const { messages, newOffset } = parseTranscriptMessages(filePath, lastOffset);
  if (messages.length === 0) {
    logger.info(`  No text messages in new data (tool calls/system only), advancing offset`);
    // Update offset even if no messages (could be tool-only lines)
    db.prepare(`
      INSERT INTO ingest_progress (file, last_offset, last_timestamp)
      VALUES (?, ?, ?)
      ON CONFLICT(file) DO UPDATE SET last_offset = ?, last_timestamp = ?
    `).run(filePath, newOffset, new Date().toISOString(), newOffset, new Date().toISOString());
    return 0;
  }

  logger.info(`  Found ${messages.length} messages (${messages.filter(m => m.role === 'user').length} user, ${messages.filter(m => m.role === 'assistant').length} assistant)`);

  const chunks = chunkMessages(messages, sessionId, filePath);
  if (chunks.length === 0) {
    logger.info(`  Messages produced 0 chunks after grouping`);
    return 0;
  }

  logger.info(`  ${messages.length} messages → ${chunks.length} chunks, embedding...`);

  // Embed chunks — truncate to ~512 tokens (~1500 chars safe for mxbai-embed-large)
  const BATCH_SIZE = 10;
  const MAX_EMBED_CHARS = 1500;
  const chunksWithEmbeddings = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, Math.min(i + BATCH_SIZE, chunks.length));
    const texts = batch.map(c => c.text.length > MAX_EMBED_CHARS ? c.text.slice(0, MAX_EMBED_CHARS) : c.text);

    try {
      const response = await embed(config.models.embed, texts);
      for (let j = 0; j < batch.length; j++) {
        chunksWithEmbeddings.push({
          ...batch[j],
          embedding: embeddingToBuffer(response.embeddings[j]),
        });
      }
    } catch (err) {
      // Batch failed — try one at a time (one bad text can poison the batch)
      logger.debug(`  Batch error, falling back to individual: ${err.message}`);
      for (let j = 0; j < batch.length; j++) {
        try {
          const response = await embed(config.models.embed, texts[j]);
          chunksWithEmbeddings.push({
            ...batch[j],
            embedding: embeddingToBuffer(response.embeddings[0]),
          });
        } catch (singleErr) {
          // Last resort: truncate more aggressively
          try {
            const shortText = texts[j].slice(0, 800);
            const response = await embed(config.models.embed, shortText);
            chunksWithEmbeddings.push({
              ...batch[j],
              embedding: embeddingToBuffer(response.embeddings[0]),
            });
          } catch {
            logger.error(`  Skipping chunk (too long even truncated): ${texts[j].slice(0, 60)}...`);
          }
        }
      }
    }
  }

  // Insert chunks
  const insert = db.prepare(`
    INSERT INTO chat_chunks (session_id, file, start_ts, end_ts, text, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const chunk of items) {
      insert.run(chunk.sessionId, chunk.file, chunk.startTs, chunk.endTs, chunk.text, chunk.embedding);
    }
  });

  insertMany(chunksWithEmbeddings);

  // Update progress
  const existingCount = progress?.chunk_count || 0;
  db.prepare(`
    INSERT INTO ingest_progress (file, last_offset, last_timestamp, chunk_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(file) DO UPDATE SET
      last_offset = ?,
      last_timestamp = ?,
      chunk_count = ?
  `).run(
    filePath, newOffset, new Date().toISOString(), existingCount + chunksWithEmbeddings.length,
    newOffset, new Date().toISOString(), existingCount + chunksWithEmbeddings.length
  );

  logger.info(`  Saved ${chunksWithEmbeddings.length} chunks`);
  for (const chunk of chunksWithEmbeddings) {
    const preview = chunk.text.replace(/\n/g, ' ').slice(0, 120);
    logger.info(`  [chunk] ${chunk.startTs || '?'} → ${preview}...`);
  }
  return chunksWithEmbeddings.length;
}

/**
 * Ingest all transcript files in the sessions directory.
 */
async function ingestAll(dbPath, sessionsDir) {
  dbPath = dbPath || config.paths.chatDb;
  sessionsDir = sessionsDir || config.paths.sessionsDir;

  if (!existsSync(sessionsDir)) {
    logger.error(`Sessions directory not found: ${sessionsDir}`);
    return;
  }

  const db = initDb(dbPath);
  const files = readdirSync(sessionsDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => join(sessionsDir, f));

  logger.info(`Found ${files.length} transcript files`);

  let totalChunks = 0;
  for (const file of files) {
    try {
      totalChunks += await ingestFile(db, file);
    } catch (err) {
      logger.error(`Error ingesting ${basename(file)}: ${err.message}`);
    }
  }

  logger.info(`Ingestion complete: ${totalChunks} new chunks added`);
  db.close();
  return totalChunks;
}

module.exports = { initDb, ingestFile, ingestAll, embeddingToBuffer, bufferToEmbedding };
