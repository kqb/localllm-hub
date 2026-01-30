const { existsSync } = require('fs');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { initDb, bufferToEmbedding } = require('./ingest');
const { vectorIndex } = require('./vector-index');

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

  // Generate query embedding once
  const embedStart = Date.now();
  const queryEmbedding = await embed(config.models.embed, query);
  const queryVector = queryEmbedding.embeddings[0];
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
      const Database = require('better-sqlite3');
      const db = new Database(memoryDbPath, { readonly: true });
      const chunks = db.prepare('SELECT * FROM chunks').all();
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
      db.close();
    } catch (err) {
      logger.debug(`Memory search error: ${err.message}`);
    }
  }

  // 2. Chat session chunks
  if (sources.includes('chat') && existsSync(chatDbPath)) {
    try {
      const db = initDb(chatDbPath);
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
      db.close();
    } catch (err) {
      logger.debug(`Chat search error: ${err.message}`);
    }
  }

  // 3. Telegram chunks
  if (sources.includes('telegram') && existsSync(chatDbPath)) {
    try {
      const db = initDb(chatDbPath);
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
      db.close();
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

module.exports = { unifiedSearch };
