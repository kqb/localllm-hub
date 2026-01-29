const Database = require('better-sqlite3');
const { existsSync } = require('fs');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { initDb, bufferToEmbedding } = require('./indexer');

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

async function search(query, dbPath, topK = 5) {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run reindex first.`);
  }

  const db = initDb(dbPath);
  logger.debug(`Searching for: "${query}"`);

  const queryEmbedding = await embed(config.models.embed, query);
  const queryVector = queryEmbedding.embeddings[0];

  const chunks = db.prepare('SELECT * FROM chunks').all();

  const results = chunks
    .map(chunk => ({
      ...chunk,
      embedding: bufferToEmbedding(chunk.embedding),
    }))
    .map(chunk => ({
      file: chunk.file,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      text: chunk.text,
      score: cosineSimilarity(queryVector, chunk.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  db.close();
  return results;
}

module.exports = { search };
