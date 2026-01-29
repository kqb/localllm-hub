const { existsSync } = require('fs');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { initDb, bufferToEmbedding } = require('./ingest');

function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search chat history by semantic similarity.
 * @param {string} query - Search query
 * @param {string} [dbPath] - Database path (defaults to config)
 * @param {number} [topK=5] - Number of results
 * @returns {Promise<Array<{ sessionId, startTs, endTs, text, score }>>}
 */
async function chatSearch(query, dbPath, topK = 5) {
  dbPath = dbPath || config.paths.chatDb;

  if (!existsSync(dbPath)) {
    throw new Error(`Chat database not found: ${dbPath}. Run 'localllm chat ingest' first.`);
  }

  const db = initDb(dbPath);
  logger.debug(`Chat search: "${query}"`);

  const queryEmbedding = await embed(config.models.embed, query);
  const queryVector = queryEmbedding.embeddings[0];

  const chunks = db.prepare('SELECT * FROM chat_chunks').all();

  const results = chunks
    .map(chunk => ({
      ...chunk,
      embedding: bufferToEmbedding(chunk.embedding),
    }))
    .map(chunk => ({
      sessionId: chunk.session_id,
      startTs: chunk.start_ts,
      endTs: chunk.end_ts,
      text: chunk.text,
      score: cosineSimilarity(queryVector, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  db.close();
  return results;
}

module.exports = { chatSearch };
