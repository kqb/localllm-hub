const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

async function generateEmbed(text, model = config.models.embed) {
  logger.debug(`Generating embedding for text: ${text.slice(0, 50)}...`);
  const response = await embed(model, text);
  return response.embeddings[0];
}

async function batchEmbed(texts, model = config.models.embed) {
  logger.debug(`Generating ${texts.length} embeddings`);
  const response = await embed(model, texts);
  return response.embeddings;
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimension');
  }

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

async function compare(textA, textB, model = config.models.embed) {
  const embeddings = await batchEmbed([textA, textB], model);
  return cosineSimilarity(embeddings[0], embeddings[1]);
}

module.exports = {
  embed: generateEmbed,
  batchEmbed,
  compare,
  cosineSimilarity,
};
