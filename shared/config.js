const { homedir } = require('os');
const { join } = require('path');

module.exports = {
  models: {
    triage: 'qwen2.5:7b',
    code: 'qwen2.5-coder:32b',
    reasoning: 'deepseek-r1:32b',
    embed: 'mxbai-embed-large',      // 1024-dim
    embedFast: 'nomic-embed-text',   // 768-dim
  },
  thresholds: {
    confidence: 0.8,
    urgency: 3,
  },
  paths: {
    memoryDir: join(homedir(), 'clawd/memory'),
    emailDb: join(homedir(), 'Projects/emailctl/emails.db'),
    searchDb: join(homedir(), 'clawd/scripts/memory.db'),
  },
  ollama: {
    url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    timeout: 30000,
  },
  embedding: {
    dimension: 1024,
    chunkSize: 500,
    chunkOverlap: 100,
  }
};
