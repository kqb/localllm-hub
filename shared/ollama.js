const { Ollama } = require('ollama');

const client = new Ollama({
  host: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
});

async function generate(model, prompt, opts = {}) {
  return client.generate({ model, prompt, stream: false, ...opts });
}

async function embed(model, input) {
  return client.embed({ model, input });
}

async function chat(model, messages, opts = {}) {
  return client.chat({ model, messages, stream: false, ...opts });
}

/**
 * Stream generation from Ollama
 * @param {string} model - Model name
 * @param {string} prompt - Text prompt
 * @param {Function} onChunk - Callback for each chunk: (chunk) => void
 * @param {Object} opts - Additional options
 * @returns {Promise<Object>} - Final response object
 */
async function streamGenerate(model, prompt, onChunk, opts = {}) {
  const url = 'http://127.0.0.1:11434/api/generate';
  const body = JSON.stringify({ model, prompt, stream: true, ...opts });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body;
  let buffer = '';
  let finalResponse = null;

  for await (const chunk of reader) {
    buffer += new TextDecoder().decode(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.response) {
          onChunk(json);
        }
        if (json.done) {
          finalResponse = json;
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    }
  }

  return finalResponse || {};
}

module.exports = { generate, embed, chat, streamGenerate, client };
