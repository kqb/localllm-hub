const { existsSync } = require('fs');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { initDb, bufferToEmbedding } = require('./ingest');
const { vectorIndex } = require('./vector-index');

// Embedding cache: normalized query → Float64Array (TTL-based)
const embeddingCache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
}

async function getQueryEmbedding(query) {
  const key = getCacheKey(query);
  const cached = embeddingCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { vector: cached.vector, fromCache: true };
  }

  const result = await embed(config.models.embed, query);
  const vector = result.embeddings[0];

  // LRU eviction
  if (embeddingCache.size >= CACHE_MAX) {
    const oldest = [...embeddingCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) embeddingCache.delete(oldest[0]);
  }

  embeddingCache.set(key, { vector, ts: Date.now() });
  return { vector, fromCache: false };
}

// Module-level connection pool (lazy init, reuse across calls)
let _memoryDb = null;
let _chatDb = null;

function getPooledMemoryDb(path) {
  if (!_memoryDb && existsSync(path)) {
    const Database = require('better-sqlite3');
    _memoryDb = new Database(path, { readonly: true });
    _memoryDb._allChunks = _memoryDb.prepare('SELECT * FROM chunks');
    logger.debug('Connection pool: opened memory.db');
  }
  return _memoryDb;
}

function getPooledChatDb(path) {
  if (!_chatDb && existsSync(path)) {
    _chatDb = initDb(path);
    logger.debug('Connection pool: opened chat-memory.db');
  }
  return _chatDb;
}

function invalidatePool() {
  if (_memoryDb) { try { _memoryDb.close(); } catch {} _memoryDb = null; }
  if (_chatDb) { try { _chatDb.close(); } catch {} _chatDb = null; }
  logger.debug('Connection pool invalidated');
}

process.on('exit', () => {
  try { _memoryDb?.close(); } catch {}
  try { _chatDb?.close(); } catch {}
});

function cosineSimilarity(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

/**
 * Unified search across all sources: memory files, chat sessions, Telegram.
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.topK=10]
 * @param {string} [opts.chatDb] - chat-memory.db path
 * @param {string} [opts.memoryDb] - memory.db path (markdown index)
 * @param {string[]} [opts.sources] - filter to specific sources: ['memory', 'chat', 'telegram']
 * @returns {Promise<Array<{ source, text, score, meta }>>}
 */
async function unifiedSearch(query, opts = {}) {
  const startTime = Date.now();
  const topK = opts.topK || 10;
  const chatDbPath = opts.chatDb || config.paths.chatDb;
  const memoryDbPath = opts.memoryDb || config.paths.searchDb;
  const sources = opts.sources || ['memory', 'chat', 'telegram'];

  // Generate query embedding once (with cache if enabled)
  const embedStart = Date.now();
  const useCache = config.contextPipeline?.features?.embeddingCache !== false;
  const { vector: queryVector, fromCache } = useCache
    ? await getQueryEmbedding(query)
    : { vector: (await embed(config.models.embed, query)).embeddings[0], fromCache: false };
  if (fromCache) logger.debug('Embedding cache hit for query');
  const embedTime = Date.now() - embedStart;

  // Use vector index if enabled (fast path)
  const useVectorIndex = config.contextPipeline?.vectorIndex?.enabled !== false;

  if (useVectorIndex) {
    try {
      const searchStart = Date.now();
      const results = vectorIndex.search(queryVector, topK, 0, sources);
      const searchTime = Date.now() - searchStart;
      const totalTime = Date.now() - startTime;

      logger.debug(`VectorIndex search: ${results.length} results, embed=${embedTime}ms, search=${searchTime}ms, total=${totalTime}ms`);
      return results;
    } catch (err) {
      logger.error(`VectorIndex search failed, falling back to SQLite: ${err.message}`);
      // Fall through to SQLite path
    }
  }

  const allResults = [];

  // 1. Memory markdown chunks
  if (sources.includes('memory') && existsSync(memoryDbPath)) {
    try {
      const usePool = config.contextPipeline?.features?.connectionPool !== false;
      let db, chunks, shouldClose = false;

      if (usePool) {
        db = getPooledMemoryDb(memoryDbPath);
        chunks = db ? db._allChunks.all() : [];
      } else {
        const Database = require('better-sqlite3');
        db = new Database(memoryDbPath, { readonly: true });
        chunks = db.prepare('SELECT * FROM chunks').all();
        shouldClose = true;
      }

      for (const chunk of chunks) {
        const embedding = bufferToEmbedding(chunk.embedding);
        allResults.push({
          source: 'memory',
          text: chunk.text,
          score: cosineSimilarity(queryVector, embedding),
          meta: {
            file: chunk.file,
            startLine: chunk.start_line,
            endLine: chunk.end_line,
          },
        });
      }

      if (shouldClose) db.close();
    } catch (err) {
      logger.debug(`Memory search error: ${err.message}`);
    }
  }

  // 2. Chat session chunks
  if (sources.includes('chat') && existsSync(chatDbPath)) {
    try {
      const usePool = config.contextPipeline?.features?.connectionPool !== false;
      let db, shouldClose = false;

      if (usePool) {
        db = getPooledChatDb(chatDbPath);
      } else {
        db = initDb(chatDbPath);
        shouldClose = true;
      }

      const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_chunks'").get();
      if (hasTable) {
        const chunks = db.prepare('SELECT * FROM chat_chunks').all();
        for (const chunk of chunks) {
          const embedding = bufferToEmbedding(chunk.embedding);
          allResults.push({
            source: 'chat',
            text: chunk.text,
            score: cosineSimilarity(queryVector, embedding),
            meta: {
              sessionId: chunk.session_id,
              startTs: chunk.start_ts,
              endTs: chunk.end_ts,
            },
          });
        }
      }

      if (shouldClose) db.close();
    } catch (err) {
      logger.debug(`Chat search error: ${err.message}`);
    }
  }

  // 3. Telegram chunks
  if (sources.includes('telegram') && existsSync(chatDbPath)) {
    try {
      const usePool = config.contextPipeline?.features?.connectionPool !== false;
      let db, shouldClose = false;

      if (usePool) {
        db = getPooledChatDb(chatDbPath);
      } else {
        db = initDb(chatDbPath);
        shouldClose = true;
      }

      const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_chunks'").get();
      if (hasTable) {
        const chunks = db.prepare('SELECT * FROM telegram_chunks').all();
        for (const chunk of chunks) {
          const embedding = bufferToEmbedding(chunk.embedding);
          allResults.push({
            source: 'telegram',
            text: chunk.text,
            score: cosineSimilarity(queryVector, embedding),
            meta: {
              startTs: chunk.start_ts,
              endTs: chunk.end_ts,
            },
          });
        }
      }

      if (shouldClose) db.close();
    } catch (err) {
      logger.debug(`Telegram search error: ${err.message}`);
    }
  }

  // Sort by score, return top K
  const results = allResults
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const totalTime = Date.now() - startTime;
  logger.debug(`SQLite search: ${results.length} results, embed=${embedTime}ms, total=${totalTime}ms`);

  return results;
}

module.exports = { unifiedSearch, invalidatePool, embeddingCache };
