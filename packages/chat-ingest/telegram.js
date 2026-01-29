const { readFileSync, existsSync } = require('fs');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { embed } = require('../../shared/ollama');
const { initDb, embeddingToBuffer } = require('./ingest');

/**
 * Parse tdl-exported Telegram JSON into messages.
 * @param {string} jsonPath - Path to the exported JSON file
 * @returns {Array<{ role: string, text: string, timestamp: string, id: number }>}
 */
function parseTelegramExport(jsonPath) {
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const rawMessages = data.messages || [];
  const botId = data.id;

  const messages = [];
  for (const msg of rawMessages) {
    if (msg.type !== 'message') continue;
    const text = (msg.text || '').trim();
    if (!text) continue;
    // Skip heartbeat noise
    if (text === 'HEARTBEAT_OK') continue;
    if (text.startsWith('Read HEARTBEAT.md')) continue;

    const timestamp = new Date(msg.date * 1000).toISOString();
    // In a bot chat, messages from the bot have from_id matching botId
    // tdl export doesn't include from_id reliably, so we infer:
    // - Short messages are likely user
    // - Long messages with markdown/code are likely bot
    // For now, store all as 'message' role — the content is what matters for search
    messages.push({
      role: 'message',
      text,
      timestamp,
      id: msg.id,
    });
  }

  return messages;
}

/**
 * Chunk Telegram messages into conversational groups.
 */
function chunkTelegramMessages(messages) {
  const maxChunkSize = config.embedding.chunkSize;
  const chunks = [];
  let currentText = '';
  let startTs = null;
  let endTs = null;
  let startId = null;
  let endId = null;

  function flush() {
    if (currentText.trim()) {
      chunks.push({
        text: currentText.trim(),
        startTs,
        endTs,
        startId,
        endId,
      });
    }
    currentText = '';
    startTs = null;
    endTs = null;
    startId = null;
    endId = null;
  }

  for (const msg of messages) {
    if ((currentText + '\n' + msg.text).length > maxChunkSize && currentText) {
      flush();
    }
    if (!startTs) { startTs = msg.timestamp; startId = msg.id; }
    endTs = msg.timestamp;
    endId = msg.id;
    currentText += (currentText ? '\n' : '') + msg.text;
  }
  flush();
  return chunks;
}

/**
 * Ingest a Telegram export JSON into the chat DB.
 */
async function ingestTelegram(jsonPath, dbPath) {
  dbPath = dbPath || config.paths.chatDb;

  if (!existsSync(jsonPath)) {
    logger.error(`Telegram export not found: ${jsonPath}`);
    return 0;
  }

  const db = initDb(dbPath);

  // Add telegram source table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      start_msg_id INTEGER,
      end_msg_id INTEGER,
      start_ts TEXT,
      end_ts TEXT,
      text TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tg_source ON telegram_chunks(source);
  `);

  // Check if already ingested
  const existing = db.prepare('SELECT COUNT(*) as count FROM telegram_chunks WHERE source = ?').get(jsonPath);
  if (existing.count > 0) {
    logger.info(`Already ingested ${existing.count} chunks from ${jsonPath}. Clearing for re-ingest.`);
    db.prepare('DELETE FROM telegram_chunks WHERE source = ?').run(jsonPath);
  }

  logger.info(`Parsing Telegram export: ${jsonPath}`);
  const messages = parseTelegramExport(jsonPath);
  logger.info(`  ${messages.length} text messages found`);

  const chunks = chunkTelegramMessages(messages);
  logger.info(`  ${chunks.length} chunks, embedding...`);

  const BATCH_SIZE = 10;
  const MAX_EMBED_CHARS = 1500;
  const chunksWithEmbeddings = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, Math.min(i + BATCH_SIZE, chunks.length));
    const texts = batch.map(c => c.text.length > MAX_EMBED_CHARS ? c.text.slice(0, MAX_EMBED_CHARS) : c.text);
    process.stdout.write(`\r  Embedding ${i + 1}-${i + batch.length}/${chunks.length}`);

    try {
      const response = await embed(config.models.embed, texts);
      for (let j = 0; j < batch.length; j++) {
        chunksWithEmbeddings.push({
          ...batch[j],
          embedding: embeddingToBuffer(response.embeddings[j]),
        });
      }
    } catch (err) {
      // Fall back to individual
      logger.debug(`  Batch error, individual fallback: ${err.message}`);
      for (let j = 0; j < batch.length; j++) {
        try {
          const t = texts[j].length > 800 ? texts[j].slice(0, 800) : texts[j];
          const response = await embed(config.models.embed, t);
          chunksWithEmbeddings.push({
            ...batch[j],
            embedding: embeddingToBuffer(response.embeddings[0]),
          });
        } catch {
          logger.error(`  Skipping chunk: ${texts[j].slice(0, 50)}...`);
        }
      }
    }
  }

  console.log('');

  const insert = db.prepare(`
    INSERT INTO telegram_chunks (source, start_msg_id, end_msg_id, start_ts, end_ts, text, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const chunk of items) {
      insert.run(jsonPath, chunk.startId, chunk.endId, chunk.startTs, chunk.endTs, chunk.text, chunk.embedding);
    }
  });

  insertMany(chunksWithEmbeddings);
  logger.info(`  Saved ${chunksWithEmbeddings.length} Telegram chunks`);

  db.close();
  return chunksWithEmbeddings.length;
}

/**
 * Search Telegram chunks.
 */
async function searchTelegram(query, dbPath, topK = 5) {
  dbPath = dbPath || config.paths.chatDb;
  const { bufferToEmbedding } = require('./ingest');

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = initDb(dbPath);
  const queryEmbedding = await embed(config.models.embed, query);
  const queryVector = queryEmbedding.embeddings[0];

  function cosineSimilarity(a, b) {
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i];
    }
    return dot / (Math.sqrt(nA) * Math.sqrt(nB));
  }

  const chunks = db.prepare('SELECT * FROM telegram_chunks').all();
  const results = chunks
    .map(c => ({
      ...c,
      embedding: bufferToEmbedding(c.embedding),
    }))
    .map(c => ({
      startTs: c.start_ts,
      endTs: c.end_ts,
      text: c.text,
      score: cosineSimilarity(queryVector, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  db.close();
  return results;
}

module.exports = { parseTelegramExport, chunkTelegramMessages, ingestTelegram, searchTelegram };
