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

module.exports = { generate, embed, chat };
