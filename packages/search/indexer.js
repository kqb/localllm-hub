const Database = require('better-sqlite3');
const { readFileSync, readdirSync, statSync } = require('fs');
const { join, relative } = require('path');
const { createHash } = require('crypto');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

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

function hashContent(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

function chunkText(text, filePath) {
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let chunkStartLine = 1;
  let currentLine = 1;

  for (const line of lines) {
    const isHeader = line.startsWith('#');
    const wouldExceed = (currentChunk + '\n' + line).length > config.embedding.chunkSize;

    if ((isHeader || wouldExceed) && currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        file: filePath,
        startLine: chunkStartLine,
        endLine: currentLine - 1
      });

      const overlapStart = Math.max(0, currentChunk.length - config.embedding.chunkOverlap);
      currentChunk = currentChunk.slice(overlapStart) + '\n' + line;
      chunkStartLine = Math.max(1, currentLine - 2);
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
    currentLine++;
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      file: filePath,
      startLine: chunkStartLine,
      endLine: currentLine - 1
    });
  }

  return chunks;
}

function findMarkdownFiles(dir) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function initDb(dbPath) {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB,
      content_hash TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);
    CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
  `);

  return db;
}

async function indexDirectory(sourceDir, dbPath) {
  logger.info('Indexing memory files to SQLite...');
  const db = initDb(dbPath);

  // Build hash index of existing chunks for cache lookup
  const existingHashes = new Map();
  try {
    const existing = db.prepare('SELECT content_hash, embedding FROM chunks WHERE content_hash IS NOT NULL').all();
    for (const row of existing) {
      existingHashes.set(row.content_hash, row.embedding);
    }
    logger.debug(`Found ${existingHashes.size} cached embeddings`);
  } catch (err) {
    logger.debug(`No existing cache: ${err.message}`);
  }

  // Clear all chunks (we'll re-insert, but with cached embeddings where possible)
  db.exec('DELETE FROM chunks');

  const files = findMarkdownFiles(sourceDir);
  logger.info(`Found ${files.length} markdown files`);

  const allChunks = [];

  for (const file of files) {
    const relPath = relative(sourceDir, file);
    logger.debug(`Processing: ${relPath}`);
    const content = readFileSync(file, 'utf-8');
    const chunks = chunkText(content, relPath);
    allChunks.push(...chunks);
  }

  logger.info(`Created ${allChunks.length} chunks, checking cache...`);

  // Compute hashes and check cache
  const chunksWithHashes = allChunks.map(chunk => ({
    ...chunk,
    hash: hashContent(chunk.text),
  }));

  let cacheHits = 0;
  let cacheMisses = 0;

  const chunksNeedingEmbedding = [];
  const chunksWithEmbeddings = [];

  for (const chunk of chunksWithHashes) {
    if (existingHashes.has(chunk.hash)) {
      // Cache hit! Reuse existing embedding
      chunksWithEmbeddings.push({
        ...chunk,
        embedding: existingHashes.get(chunk.hash),
      });
      cacheHits++;
    } else {
      // Cache miss - need to embed
      chunksNeedingEmbedding.push(chunk);
      cacheMisses++;
    }
  }

  logger.info(`Cache: ${cacheHits} hits, ${cacheMisses} misses`);

  // Embed cache misses
  if (chunksNeedingEmbedding.length > 0) {
    const BATCH_SIZE = 10;
    for (let i = 0; i < chunksNeedingEmbedding.length; i += BATCH_SIZE) {
      const batch = chunksNeedingEmbedding.slice(i, Math.min(i + BATCH_SIZE, chunksNeedingEmbedding.length));
      process.stdout.write(`\r  Embedding ${i + 1}-${i + batch.length}/${chunksNeedingEmbedding.length}`);

      try {
        const texts = batch.map(c => c.text);
        const response = await embed(config.models.embed, texts);

        for (let j = 0; j < batch.length; j++) {
          chunksWithEmbeddings.push({
            ...batch[j],
            embedding: embeddingToBuffer(response.embeddings[j]),
          });
        }
      } catch (err) {
        logger.error(`Error embedding batch: ${err.message}`);
      }
    }
    console.log('');
  }

  logger.info('Saving to SQLite...');

  const insert = db.prepare(`
    INSERT INTO chunks (file, start_line, end_line, text, embedding, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((chunks) => {
    for (const chunk of chunks) {
      insert.run(chunk.file, chunk.startLine, chunk.endLine, chunk.text, chunk.embedding, chunk.hash);
    }
  });

  insertMany(chunksWithEmbeddings);

  const count = db.prepare('SELECT COUNT(*) as count FROM chunks').get();
  logger.info(`Saved ${count.count} chunks to ${dbPath} (${cacheHits} from cache, ${cacheMisses} newly embedded)`);

  db.close();
}

module.exports = {
  indexDirectory,
  initDb,
  embeddingToBuffer,
  bufferToEmbedding,
  chunkText,
  findMarkdownFiles,
  hashContent,
};
