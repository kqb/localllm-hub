const { homedir } = require('os');
const { join } = require('path');
const { existsSync, readFileSync } = require('fs');

const OVERRIDES_PATH = join(__dirname, '..', 'config.local.json');

const defaults = {
  models: {
    triage: 'qwen2.5:14b',           // UPGRADED: 14B for better routing accuracy
    code: 'qwen2.5-coder:14b',
    reasoning: 'deepseek-r1:14b',    // LOCAL reasoning (logic/math)
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
    chatDb: join(homedir(), 'clawd/scripts/chat-memory.db'),
    sessionsDir: join(homedir(), '.clawdbot/agents/main/sessions'),
  },
  ollama: {
    url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    timeout: 30000,
  },
  embedding: {
    dimension: 1024,
    chunkSize: 1500,
    chunkOverlap: 300,
  },
  watcher: {
    pollInterval: 5000,
    debounce: 2000,
    newFileScan: 30000,
  },
  contextPipeline: {
    enabled: true,
    shortTerm: {
      enabled: true,
      maxMessages: 20,
      maxTokenEstimate: 8000,
    },
    rag: {
      enabled: true,
      topK: 5,
      minScore: 0.3,
      sources: ['memory', 'chat', 'telegram'],
      injectAs: 'system',
    },
    routing: {
      enabled: true,
      model: 'qwen2.5:14b',          // UPGRADED: 14B for better classification
      fallback: 'claude_sonnet',
      enforceModel: false,
      overrides: {},
    },
    systemNotes: {
      enabled: true,
      includeWingmanResults: true,
      maxNotes: 10,
    },
    persistence: {
      enabled: true,
      saveTurns: true,
      saveToDb: true,
    },
  },
};

// Deep merge: overrides win
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function loadConfig() {
  let overrides = {};
  if (existsSync(OVERRIDES_PATH)) {
    try {
      overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf-8'));
    } catch (e) {
      console.error(`[config] Failed to load overrides: ${e.message}`);
    }
  }
  return deepMerge(defaults, overrides);
}

// Export a live config that reloads on access
const config = loadConfig();
config._reload = loadConfig;
config._overridesPath = OVERRIDES_PATH;
config._defaults = defaults;

module.exports = config;
