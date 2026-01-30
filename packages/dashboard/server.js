const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { existsSync, statSync } = require('fs');
const { execFile } = require('child_process');

const { readFileSync, readdirSync } = require('fs');
const os = require('os');

const config = require('../../shared/config');

const PORT = process.env.DASHBOARD_PORT || 3847;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- helpers ---

function ollamaFetch(urlPath, opts = {}) {
  const url = `${config.ollama.url}${urlPath}`;
  return fetch(url, { signal: AbortSignal.timeout(5000), ...opts })
    .then(r => r.ok ? r.json().catch(() => ({ ok: true })) : Promise.reject(new Error(`HTTP ${r.status}`)))
    .catch(err => ({ error: err.message }));
}

function getDbStats(dbPath, label) {
  if (!existsSync(dbPath)) return { exists: false, label };
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const size = statSync(dbPath).size;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    const counts = {};
    for (const t of tables) {
      try { counts[t] = db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get().c; } catch { counts[t] = -1; }
    }
    db.close();
    return { exists: true, label, sizeBytes: size, tables: counts };
  } catch (err) {
    return { exists: true, label, error: err.message };
  }
}

function findWhisper() {
  const candidates = ['/usr/local/bin/whisper-cpp', '/opt/homebrew/bin/whisper-cpp'];
  if (process.env.WHISPER_CPP_PATH) candidates.unshift(process.env.WHISPER_CPP_PATH);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// --- API routes ---

app.get('/api/status', async (_req, res) => {
  const [ollama, memoryDb, chatDb] = await Promise.all([
    ollamaFetch('/'),
    Promise.resolve(getDbStats(config.paths.searchDb, 'memory.db')),
    Promise.resolve(getDbStats(config.paths.chatDb, 'chat-memory.db')),
  ]);
  const whisperPath = findWhisper();
  res.json({
    ollama: { healthy: !ollama.error, detail: ollama },
    whisper: { found: !!whisperPath, path: whisperPath },
    databases: [memoryDb, chatDb],
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/models', async (_req, res) => {
  const data = await ollamaFetch('/api/tags');
  res.json(data);
});

app.get('/api/search', async (req, res) => {
  const { q, sources, topK } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
  try {
    const { unifiedSearch } = require('../chat-ingest/unified-search');
    const results = await unifiedSearch(q, {
      topK: parseInt(topK) || 5,
      sources: sources ? sources.split(',') : ['memory', 'chat', 'telegram'],
    });
    res.json({ query: q, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reindex', async (_req, res) => {
  try {
    const { indexDirectory } = require('../search/indexer');
    const source = config.paths.memoryDir;
    const dbPath = config.paths.searchDb;
    // Run in background so we can respond immediately
    indexDirectory(source, dbPath).catch(err => console.error('Reindex error:', err.message));
    res.json({ status: 'started', source, db: dbPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/embeddings/sample', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  try {
    const Database = require('better-sqlite3');
    const dbPath = config.paths.searchDb;

    if (!existsSync(dbPath)) {
      return res.status(404).json({ error: 'Memory database not found. Run reindex first.' });
    }

    const db = new Database(dbPath, { readonly: true });
    const chunks = db.prepare('SELECT id, file, text, embedding FROM chunks ORDER BY RANDOM() LIMIT ?').all(limit);

    const samples = chunks.map(chunk => {
      const embedding = [];
      const buf = chunk.embedding;
      for (let i = 0; i < buf.length; i += 4) {
        embedding.push(buf.readFloatLE(i));
      }

      return {
        id: chunk.id,
        file: chunk.file,
        text: chunk.text.slice(0, 200), // Truncate for transfer
        embedding,
      };
    });

    db.close();
    res.json({ samples, count: samples.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/packages', (_req, res) => {
  const pkgs = ['embeddings', 'classifier', 'triage', 'search', 'transcriber', 'chat-ingest'];
  const results = pkgs.map(name => {
    const pkgDir = path.join(__dirname, '..', name);
    const exists = existsSync(pkgDir);
    let version = null;
    let mainFile = null;
    if (exists) {
      try {
        const pkg = require(path.join(pkgDir, 'package.json'));
        version = pkg.version;
        mainFile = pkg.main || 'index.js';
      } catch { /* no package.json */ }
    }
    return { name, exists, version, mainFile };
  });
  res.json(results);
});

app.get('/api/jobs', (_req, res) => {
  const dbPath = config.paths.chatDb;
  if (!existsSync(dbPath)) return res.json({ hasData: false });
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const stats = {};
    const hasChunks = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_chunks'").get();
    if (hasChunks) {
      stats.chatChunks = db.prepare('SELECT COUNT(*) as c FROM chat_chunks').get().c;
      stats.chatSessions = db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM chat_chunks').get().c;
    }
    const hasProgress = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ingest_progress'").get();
    if (hasProgress) {
      stats.filesIndexed = db.prepare('SELECT COUNT(*) as c FROM ingest_progress').get().c;
      stats.lastUpdate = db.prepare('SELECT MAX(last_timestamp) as ts FROM ingest_progress').get().ts;
    }
    const hasTelegram = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_chunks'").get();
    if (hasTelegram) {
      stats.telegramChunks = db.prepare('SELECT COUNT(*) as c FROM telegram_chunks').get().c;
    }
    db.close();
    res.json({ hasData: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Daemons ---

const DAEMONS = [
  { label: 'com.localllm.chat-ingest', name: 'Chat Ingest Watcher', logFile: '/Users/yuzucchi/.clawdbot/logs/chat-ingest.log', errFile: '/Users/yuzucchi/.clawdbot/logs/chat-ingest.err' },
];

function getDaemonStatus(label) {
  return new Promise((resolve) => {
    execFile('/bin/launchctl', ['list', label], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve({ label, running: false, error: err.message });
      const pidMatch = stdout.match(/"PID"\s*=\s*(\d+)/);
      const exitMatch = stdout.match(/"LastExitStatus"\s*=\s*(\d+)/);
      resolve({
        label,
        running: !!pidMatch,
        pid: pidMatch ? parseInt(pidMatch[1]) : null,
        lastExitStatus: exitMatch ? parseInt(exitMatch[1]) : null,
      });
    });
  });
}

function getDaemonLogs(filePath, lines = 20) {
  return new Promise((resolve) => {
    execFile('/usr/bin/tail', ['-n', String(lines), filePath], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve({ error: err.message });
      resolve({ lines: stdout.split('\n').filter(Boolean) });
    });
  });
}

app.get('/api/daemons', async (_req, res) => {
  const results = await Promise.all(DAEMONS.map(async (d) => {
    const status = await getDaemonStatus(d.label);
    return { ...d, ...status };
  }));
  res.json(results);
});

app.get('/api/daemons/:label/logs', async (req, res) => {
  const daemon = DAEMONS.find(d => d.label === req.params.label);
  if (!daemon) return res.status(404).json({ error: 'Unknown daemon' });
  const lines = parseInt(req.query.lines) || 50;
  const src = req.query.src; // 'out', 'err', or undefined (both)

  const fetches = [];
  if (!src || src === 'out') fetches.push(getDaemonLogs(daemon.logFile, lines).then(r => (r.lines || []).map(l => ({ text: l, src: 'out' }))));
  if (!src || src === 'err') fetches.push(getDaemonLogs(daemon.errFile, lines).then(r => (r.lines || []).map(l => ({ text: l, src: 'err' }))));

  const results = await Promise.all(fetches);
  const allLines = results.flat();

  // Sort by timestamp if present
  allLines.sort((a, b) => {
    const ta = a.text.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]/);
    const tb = b.text.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]/);
    if (ta && tb) return ta[1].localeCompare(tb[1]);
    if (ta && !tb) return 1;
    if (!ta && tb) return -1;
    return 0;
  });
  const merged = allLines.slice(-lines);
  res.json({ lines: merged });
});

app.post('/api/daemons/:label/restart', (req, res) => {
  const daemon = DAEMONS.find(d => d.label === req.params.label);
  if (!daemon) return res.status(404).json({ error: 'Unknown daemon' });
  execFile('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${daemon.label}`], { timeout: 5000 }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'restarted', label: daemon.label });
  });
});

// --- Memory Config ---

app.get('/api/memory', (_req, res) => {
  const { readdirSync } = require('fs');
  const memoryDir = config.paths.memoryDir;
  const memoryMd = path.join(memoryDir, '..', 'MEMORY.md');

  // Memory files
  let files = [];
  try {
    const allFiles = readdirSync(memoryDir, { withFileTypes: true });
    files = allFiles.filter(f => f.isFile() && f.name.endsWith('.md')).map(f => {
      const fp = path.join(memoryDir, f.name);
      const st = statSync(fp);
      return { name: f.name, sizeBytes: st.size, modified: st.mtime.toISOString() };
    }).sort((a, b) => b.modified.localeCompare(a.modified));
  } catch (e) { files = [{ error: e.message }]; }

  // Subdirectories
  let subdirs = [];
  try {
    const allEntries = readdirSync(memoryDir, { withFileTypes: true });
    subdirs = allEntries.filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => {
      const dp = path.join(memoryDir, d.name);
      const count = readdirSync(dp).filter(f => f.endsWith('.md')).length;
      return { name: d.name, fileCount: count };
    });
  } catch {}

  // MEMORY.md stats
  let memoryMdStats = null;
  if (existsSync(memoryMd)) {
    const st = statSync(memoryMd);
    const content = require('fs').readFileSync(memoryMd, 'utf-8');
    memoryMdStats = { sizeBytes: st.size, lines: content.split('\n').length, modified: st.mtime.toISOString() };
  }

  // Embedding config
  const embeddingConfig = config.embedding;

  // DB stats
  const searchDb = getDbStats(config.paths.searchDb, 'memory.db');
  const chatDb = getDbStats(config.paths.chatDb, 'chat-memory.db');

  // Pipeline info
  const pipeline = {
    sources: [
      { name: 'Memory Files', path: config.paths.memoryDir, description: 'Daily notes, corrections, learnings' },
      { name: 'MEMORY.md', path: memoryMd, description: 'Curated long-term memory' },
      { name: 'Chat Sessions', path: config.paths.sessionsDir, description: 'JSONL transcripts auto-ingested' },
    ],
    embedding: {
      model: config.models.embed,
      dimension: embeddingConfig.dimension,
      chunkSize: embeddingConfig.chunkSize,
      chunkOverlap: embeddingConfig.chunkOverlap,
    },
    storage: {
      memoryDb: config.paths.searchDb,
      chatDb: config.paths.chatDb,
    },
    watcher: {
      daemon: 'com.localllm.chat-ingest',
      pollInterval: '5s (watchFile)',
      debounce: '2s',
      newFileScan: '30s',
    },
  };

  res.json({
    memoryMd: memoryMdStats,
    files,
    subdirs,
    embeddingConfig,
    searchDb,
    chatDb,
    pipeline,
  });
});

// --- Clawdbot Config ---

const CLAWDBOT_CONFIG_PATH = path.join(require('os').homedir(), '.clawdbot/clawdbot.json');

app.get('/api/clawdbot/config', (_req, res) => {
  try {
    const raw = require('fs').readFileSync(CLAWDBOT_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const mem = parsed.agents?.defaults?.memorySearch || {};
    const compaction = parsed.agents?.defaults?.compaction || {};
    const hooks = parsed.hooks?.internal?.entries || {};
    res.json({
      memorySearch: mem,
      compaction,
      hooks,
      model: parsed.agents?.defaults?.model,
      workspace: parsed.agents?.defaults?.workspace,
      thinkingDefault: parsed.agents?.defaults?.thinkingDefault,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clawdbot/config', (req, res) => {
  try {
    const raw = require('fs').readFileSync(CLAWDBOT_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const patch = req.body;

    if (!parsed.agents) parsed.agents = {};
    if (!parsed.agents.defaults) parsed.agents.defaults = {};

    // Apply model patch
    if (patch.model) {
      parsed.agents.defaults.model = {
        ...parsed.agents.defaults.model,
        ...patch.model,
      };
    }

    // Apply memory search patch
    if (patch.memorySearch) {
      parsed.agents.defaults.memorySearch = {
        ...parsed.agents.defaults.memorySearch,
        ...patch.memorySearch,
      };
      // Deep merge remote
      if (patch.memorySearch.remote) {
        parsed.agents.defaults.memorySearch.remote = {
          ...(parsed.agents.defaults.memorySearch.remote || {}),
          ...patch.memorySearch.remote,
        };
      }
      // Deep merge experimental
      if (patch.memorySearch.experimental) {
        parsed.agents.defaults.memorySearch.experimental = {
          ...(parsed.agents.defaults.memorySearch.experimental || {}),
          ...patch.memorySearch.experimental,
        };
      }
      // Deep merge store
      if (patch.memorySearch.store) {
        parsed.agents.defaults.memorySearch.store = {
          ...(parsed.agents.defaults.memorySearch.store || {}),
          ...patch.memorySearch.store,
        };
      }
      // Deep merge query
      if (patch.memorySearch.query) {
        parsed.agents.defaults.memorySearch.query = {
          ...(parsed.agents.defaults.memorySearch.query || {}),
          ...patch.memorySearch.query,
        };
      }
    }

    // Apply compaction patch
    if (patch.compaction) {
      parsed.agents.defaults.compaction = {
        ...parsed.agents.defaults.compaction,
        ...patch.compaction,
      };
      if (patch.compaction.memoryFlush) {
        parsed.agents.defaults.compaction.memoryFlush = {
          ...(parsed.agents.defaults.compaction.memoryFlush || {}),
          ...patch.compaction.memoryFlush,
        };
      }
    }

    require('fs').writeFileSync(CLAWDBOT_CONFIG_PATH, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    res.json({ status: 'saved', note: 'Restart Clawdbot gateway to apply changes' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Config Save ---

app.post('/api/config', (req, res) => {
  const { writeFileSync } = require('fs');
  const overridesPath = config._overridesPath;
  const patch = req.body;

  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'Invalid config patch' });
  }

  // Load existing overrides
  let existing = {};
  if (existsSync(overridesPath)) {
    try { existing = JSON.parse(require('fs').readFileSync(overridesPath, 'utf-8')); } catch {}
  }

  // Deep merge patch into existing overrides
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

  const merged = deepMerge(existing, patch);

  try {
    writeFileSync(overridesPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

    // Hot-reload config in memory
    const fresh = config._reload();
    Object.assign(config, fresh);

    res.json({ status: 'saved', overridesPath, config: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (_req, res) => {
  const overridesPath = config._overridesPath;
  let overrides = {};
  if (existsSync(overridesPath)) {
    try { overrides = JSON.parse(require('fs').readFileSync(overridesPath, 'utf-8')); } catch {}
  }
  res.json({
    defaults: config._defaults,
    overrides,
    active: {
      models: config.models,
      thresholds: config.thresholds,
      embedding: config.embedding,
      watcher: config.watcher,
      paths: config.paths,
      ollama: config.ollama,
    },
  });
});

// --- Agent Monitor ---

function getAgentSessions() {
  return new Promise((resolve) => {
    execFile('clawdbot', ['sessions', 'list', '--json'], { timeout: 5000 }, (err, stdout) => {
      let clawdbotSessions = [];
      if (!err) {
        try {
          const parsed = JSON.parse(stdout);
          const rawSessions = Array.isArray(parsed) ? parsed : parsed.sessions || [];
          clawdbotSessions = rawSessions.map(s => ({
            key: s.key || s.sessionKey || s.sessionId || 'unknown',
            agentId: s.agentId || null,
            kind: 'clawdbot',
            model: s.model || 'unknown',
            updatedAt: s.updatedAt || null,
            totalTokens: s.totalTokens || 0,
            contextTokens: s.contextTokens || 0,
            percentUsed: s.contextTokens ? Math.round((s.totalTokens / s.contextTokens) * 100) : 0,
            inputTokens: s.inputTokens || 0,
            outputTokens: s.outputTokens || 0,
          }));
        } catch { /* parse error */ }
      }

      // Also check tmux sessions
      execFile('tmux', ['ls', '-F', '#{session_name}:#{session_activity}'], { timeout: 3000 }, (tmuxErr, tmuxOut) => {
        let tmuxSessions = [];
        if (!tmuxErr && tmuxOut.trim()) {
          tmuxSessions = tmuxOut.trim().split('\n').map(line => {
            const [name, activity] = line.split(':');
            const updatedAt = activity ? new Date(parseInt(activity) * 1000).toISOString() : null;
            return {
              key: name,
              agentId: null,
              kind: 'tmux',
              model: null,
              updatedAt,
              totalTokens: 0,
              contextTokens: 0,
              percentUsed: 0,
            };
          });
        }
        resolve([...clawdbotSessions, ...tmuxSessions]);
      });
    });
  });
}

app.get('/api/agents', async (_req, res) => {
  try {
    const sessions = await getAgentSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/:sessionKey/log', (req, res) => {
  const key = req.params.sessionKey;
  const kind = req.query.kind || 'clawdbot';

  if (kind === 'tmux') {
    execFile('tmux', ['capture-pane', '-t', key, '-p', '-S', '-100'], { timeout: 5000 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ type: 'tmux', lines: stdout.split('\n') });
    });
  } else {
    execFile('clawdbot', ['sessions', 'history', key, '--json', '--limit', '20'], { timeout: 5000 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      try {
        const parsed = JSON.parse(stdout);
        res.json({ type: 'clawdbot', messages: Array.isArray(parsed) ? parsed : parsed.messages || [] });
      } catch (e) {
        res.status(500).json({ error: 'Parse error: ' + e.message });
      }
    });
  }
});

app.post('/api/agents/:sessionKey/send', (req, res) => {
  const key = req.params.sessionKey;
  const kind = req.query.kind || 'clawdbot';
  const message = req.body.message;

  if (!message) return res.status(400).json({ error: 'Missing message' });

  if (kind === 'tmux') {
    execFile('tmux', ['send-keys', '-t', key, message, 'Enter'], { timeout: 5000 }, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ status: 'sent', kind: 'tmux' });
    });
  } else {
    execFile('clawdbot', ['sessions', 'send', key, '--message', message], { timeout: 10000 }, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ status: 'sent', kind: 'clawdbot', output: stdout });
    });
  }
});

// --- Chat API ---

const SESSION_DIR = path.join(os.homedir(), '.clawdbot', 'agents', 'main', 'sessions');
const _chatCache = new Map(); // sessionId -> { mtime, messages }

function parseSessionJsonl(sessionId) {
  const fp = path.join(SESSION_DIR, sessionId + '.jsonl');
  if (!existsSync(fp)) return null;
  const st = statSync(fp);
  const cached = _chatCache.get(sessionId);
  if (cached && cached.mtime === st.mtimeMs) return cached.messages;

  const raw = readFileSync(fp, 'utf-8');
  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      const role = msg.role || '';
      const parsed = {
        id: entry.id, parentId: entry.parentId,
        timestamp: msg.timestamp || entry.timestamp,
        role,
        text: null, thinking: null, toolCalls: [], toolResult: null,
        model: msg.model || null,
        usage: msg.usage ? { input: msg.usage.inputTokens || msg.usage.input || 0, output: msg.usage.outputTokens || msg.usage.output || 0 } : null,
        stopReason: msg.stopReason || null,
      };

      const content = msg.content;
      if (typeof content === 'string') {
        parsed.text = content;
      } else if (Array.isArray(content)) {
        const textParts = [];
        for (const block of content) {
          if (block.type === 'text') textParts.push(block.text);
          else if (block.type === 'thinking') parsed.thinking = block.thinking;
          else if (block.type === 'toolCall') parsed.toolCalls.push({ id: block.id, name: block.name, arguments: block.arguments });
        }
        if (textParts.length) parsed.text = textParts.join('\n');
      }

      if (role === 'toolResult') {
        const resultText = Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('\n') : (typeof content === 'string' ? content : '');
        parsed.toolResult = {
          toolName: msg.toolName || null,
          toolCallId: msg.toolCallId || null,
          content: resultText,
          isError: msg.isError || false,
          details: msg.details || null,
        };
      }
      messages.push(parsed);
    } catch { /* skip bad lines */ }
  }
  _chatCache.set(sessionId, { mtime: st.mtimeMs, messages });
  return messages;
}

app.get('/api/chat/sessions', (_req, res) => {
  try {
    if (!existsSync(SESSION_DIR)) return res.json([]);
    const files = readdirSync(SESSION_DIR).filter(f => f.endsWith('.jsonl') && !f.includes('.deleted') && !f.includes('.lock'));
    const sessions = files.map(f => {
      const fp = path.join(SESSION_DIR, f);
      const st = statSync(fp);
      return {
        sessionId: f.replace('.jsonl', ''),
        filename: f,
        sizeBytes: st.size,
        lastModified: st.mtimeMs,
      };
    }).sort((a, b) => b.lastModified - a.lastModified);
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chat/:sessionId/messages', (req, res) => {
  try {
    const messages = parseSessionJsonl(req.params.sessionId);
    if (!messages) return res.status(404).json({ error: 'Session not found' });
    const total = messages.length;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    // offset from end: 0 = last N messages
    const start = Math.max(0, total - offset - limit);
    const end = Math.max(0, total - offset);
    const slice = messages.slice(start, end);
    res.json({ messages: slice, total, hasMore: start > 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chat/:sessionId/messages/stream', (req, res) => {
  try {
    const messages = parseSessionJsonl(req.params.sessionId);
    if (!messages) return res.status(404).json({ error: 'Session not found' });
    const n = Math.min(parseInt(req.query.last) || 20, 100);
    const slice = messages.slice(-n);
    res.json({ messages: slice, total: messages.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Context Monitor ---

app.get('/api/context-monitor', async (_req, res) => {
  const home = os.homedir();
  const clawdDir = path.join(home, 'clawd');

  // 1. Shell out to clawdbot status --json
  const sessionStats = await new Promise((resolve) => {
    execFile('clawdbot', ['status', '--json'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ error: err.message });
      try {
        const parsed = JSON.parse(stdout);
        const recent = parsed.sessions?.recent?.[0];
        if (!recent) return resolve({ error: 'No recent session' });
        resolve({
          totalTokens: recent.totalTokens || 0,
          contextTokens: recent.contextTokens || 0,
          remainingTokens: recent.remainingTokens || 0,
          percentUsed: recent.percentUsed || 0,
          model: recent.model || 'unknown',
          inputTokens: recent.inputTokens || 0,
          outputTokens: recent.outputTokens || 0,
        });
      } catch (e) {
        resolve({ error: 'Parse error: ' + e.message });
      }
    });
  });

  // 2. Injected file sizes
  const INJECTED_FILES = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md'];
  const injectedFiles = INJECTED_FILES.map(name => {
    const fp = path.join(clawdDir, name);
    try {
      const st = statSync(fp);
      const bytes = st.size;
      return { name, bytes, estTokens: Math.round(bytes / 4) };
    } catch {
      return { name, bytes: 0, estTokens: 0, missing: true };
    }
  });
  const injectedTotal = {
    bytes: injectedFiles.reduce((s, f) => s + f.bytes, 0),
    estTokens: injectedFiles.reduce((s, f) => s + f.estTokens, 0),
  };

  // 3. Memory stats
  const memoryDir = path.join(clawdDir, 'memory');
  let memoryStats = { dailyFiles: 0, memoryMd: null, todayLog: null };
  try {
    const files = readdirSync(memoryDir).filter(f => f.endsWith('.md'));
    memoryStats.dailyFiles = files.length;
  } catch {}

  const memoryMdPath = path.join(clawdDir, 'MEMORY.md');
  if (existsSync(memoryMdPath)) {
    try {
      const st = statSync(memoryMdPath);
      const content = readFileSync(memoryMdPath, 'utf-8');
      memoryStats.memoryMd = { bytes: st.size, lines: content.split('\n').length };
    } catch {}
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayPath = path.join(memoryDir, `${today}.md`);
  if (existsSync(todayPath)) {
    try {
      const st = statSync(todayPath);
      memoryStats.todayLog = { bytes: st.size };
    } catch {}
  }

  res.json({ session: sessionStats, injectedFiles, injectedTotal, memory: memoryStats });
});

// --- Panel: Model Manager ---

app.get('/api/models/available', async (_req, res) => {
  const data = await ollamaFetch('/api/tags');
  if (data.error) return res.status(502).json({ error: data.error });
  const models = (data.models || []).map(m => ({
    name: m.name,
    size: m.size || 0,
    family: m.details?.family || null,
    parameterSize: m.details?.parameter_size || null,
    quantization: m.details?.quantization_level || null,
    modifiedAt: m.modified_at || null,
  }));
  // Check which models are currently loaded (have been used recently)
  const psData = await ollamaFetch('/api/ps');
  const loadedNames = new Set((psData.models || []).map(m => m.name));
  for (const m of models) {
    m.loaded = loadedNames.has(m.name);
  }
  res.json({ models });
});

app.post('/api/models/pull', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing model name' });
  try {
    const url = `${config.ollama.url}/api/pull`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
      signal: AbortSignal.timeout(600000), // 10 min for large pulls
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `Ollama returned ${resp.status}` });
    const data = await resp.json().catch(() => ({ status: 'success' }));
    res.json({ status: 'pulled', name, detail: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/models/delete', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing model name' });
  try {
    const url = `${config.ollama.url}/api/delete`;
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `Ollama returned ${resp.status}` });
    res.json({ status: 'deleted', name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/models/warm', async (req, res) => {
  const { name, keep_alive } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing model name' });
  try {
    const url = `${config.ollama.url}/api/generate`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, prompt: '', keep_alive: keep_alive || '10m', stream: false }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `Ollama returned ${resp.status}` });
    res.json({ status: 'warmed', name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Panel: Model Budget Visualizer ---

app.get('/api/budget', async (_req, res) => {
  const TOTAL_RAM = 36 * 1024 * 1024 * 1024; // 36GB
  const OS_OVERHEAD = 9 * 1024 * 1024 * 1024; // ~9GB

  const data = await ollamaFetch('/api/tags');
  const models = data.models || [];

  const psData = await ollamaFetch('/api/ps');
  const loadedModels = psData.models || [];
  const loadedNames = new Set(loadedModels.map(m => m.name));

  const modelList = models.map(m => ({
    name: m.name,
    size: m.size || 0,
    loaded: loadedNames.has(m.name),
    family: m.details?.family || null,
  }));

  const loadedSize = modelList.filter(m => m.loaded).reduce((s, m) => s + m.size, 0);
  const freeHeadroom = TOTAL_RAM - OS_OVERHEAD - loadedSize;

  res.json({
    totalRam: TOTAL_RAM,
    osOverhead: OS_OVERHEAD,
    loadedSize,
    freeHeadroom: Math.max(0, freeHeadroom),
    models: modelList,
  });
});

// --- Panel: Route Switcher ---

app.get('/api/routes/config', (_req, res) => {
  const overridesPath = config._overridesPath;
  let overrides = {};
  if (existsSync(overridesPath)) {
    try { overrides = JSON.parse(require('fs').readFileSync(overridesPath, 'utf-8')); } catch {}
  }
  res.json({
    routes: overrides.routes || null,
    routerModel: config.models.triage,
    tiers: [
      { tier: 'S1', model: 'Gemini 3 Pro', role: 'The Visionary', use: 'Deep reasoning, 1M+ context, strategic planning', cost: 'Free (browser)' },
      { tier: 'S2', model: 'Claude 4.5 Opus', role: 'The Auditor', use: 'Critical execution, security audits, production code', cost: 'Max sub' },
      { tier: 'A', model: 'Claude Sonnet', role: 'The Engineer', use: 'Coding loop: features, bugs, tests (80% of work)', cost: 'Max sub' },
      { tier: 'B', model: 'Claude Haiku', role: 'The Analyst', use: 'Triage, summarization, data extraction, fast Q&A', cost: 'Max sub' },
      { tier: 'C', model: 'Qwen 2.5 14B', role: 'The Intern', use: 'Note search, file discovery, classification, routing', cost: 'Free (local)' },
    ],
  });
});

app.post('/api/routes/test', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  try {
    const { routeToModel } = require('../triage');
    const result = await routeToModel(prompt);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Panel: RAG Inspector ---

app.get('/api/rag/chunks', (req, res) => {
  const source = req.query.source || 'memory';
  const offset = parseInt(req.query.offset) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const dbPath = source === 'chat' ? config.paths.chatDb : config.paths.searchDb;
  const tableName = source === 'chat' ? 'chat_chunks' : 'chunks';

  if (!existsSync(dbPath)) return res.json({ chunks: [], total: 0, source });

  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    if (!hasTable) { db.close(); return res.json({ chunks: [], total: 0, source }); }

    const total = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c;

    let rows;
    if (source === 'chat') {
      rows = db.prepare(`SELECT id, session_id, file, start_ts, end_ts, text FROM "${tableName}" ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset);
    } else {
      rows = db.prepare(`SELECT id, file, start_line, end_line, text FROM "${tableName}" ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset);
    }

    db.close();
    res.json({ chunks: rows, total, source, offset, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rag/config', (_req, res) => {
  res.json({
    chunkSize: config.embedding.chunkSize,
    chunkOverlap: config.embedding.chunkOverlap,
    dimension: config.embedding.dimension,
    model: config.models.embed,
    searchDb: config.paths.searchDb,
    chatDb: config.paths.chatDb,
  });
});

app.post('/api/rag/reindex', async (_req, res) => {
  try {
    const { indexDirectory } = require('../search/indexer');
    const source = config.paths.memoryDir;
    const dbPath = config.paths.searchDb;
    indexDirectory(source, dbPath).catch(err => console.error('Reindex error:', err.message));
    res.json({ status: 'started', source, db: dbPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Panel: Token Economics ---

app.get('/api/economics', (_req, res) => {
  try {
    if (!existsSync(SESSION_DIR)) return res.json({ sessions: 0, models: {} });

    const files = readdirSync(SESSION_DIR).filter(f => f.endsWith('.jsonl') && !f.includes('.deleted') && !f.includes('.lock'));

    const modelStats = {};
    let sessionCount = 0;

    for (const file of files) {
      sessionCount++;
      const fp = path.join(SESSION_DIR, file);

      // Use cached parse if available
      const messages = parseSessionJsonl(file.replace('.jsonl', ''));
      if (!messages) continue;

      for (const msg of messages) {
        if (!msg.usage || !msg.model) continue;
        const model = msg.model;
        if (!modelStats[model]) {
          modelStats[model] = { inputTokens: 0, outputTokens: 0, messageCount: 0 };
        }
        modelStats[model].inputTokens += msg.usage.input || 0;
        modelStats[model].outputTokens += msg.usage.output || 0;
        modelStats[model].messageCount++;
      }
    }

    // Cost estimates (per million tokens) — what it would cost at API rates
    const COST_RATES = {
      'claude-opus-4-5': { input: 15, output: 75 },
      'claude-4-opus': { input: 15, output: 75 },
      'claude-sonnet-4-5': { input: 3, output: 15 },
      'claude-4-sonnet': { input: 3, output: 15 },
      'claude-3-5-sonnet': { input: 3, output: 15 },
      'claude-3-5-haiku': { input: 0.80, output: 4 },
    };

    let totalEstimatedCost = 0;
    for (const [model, stats] of Object.entries(modelStats)) {
      // Find matching cost rate by substring
      let rate = null;
      for (const [key, r] of Object.entries(COST_RATES)) {
        if (model.includes(key)) { rate = r; break; }
      }
      if (rate) {
        stats.estimatedCost = (stats.inputTokens / 1000000) * rate.input + (stats.outputTokens / 1000000) * rate.output;
        totalEstimatedCost += stats.estimatedCost;
      } else {
        stats.estimatedCost = null;
      }
    }

    res.json({
      sessions: sessionCount,
      models: modelStats,
      totalEstimatedCost,
      note: 'Estimated API cost if not using Max subscription. Actual cost: $0 (flat rate).',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Panel: Prompt Editor (Workspace Files) ---

const WORKSPACE_DIR = path.join(os.homedir(), 'clawd');
const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'HEARTBEAT.md', 'IDENTITY.md', 'TOOLS.md', 'MEMORY.md'];

function isValidWorkspaceFile(name) {
  // Reject path traversal and only allow known files
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return WORKSPACE_FILES.includes(name);
}

app.get('/api/workspace/files', (_req, res) => {
  const files = WORKSPACE_FILES.map(name => {
    const fp = path.join(WORKSPACE_DIR, name);
    try {
      const st = statSync(fp);
      return { name, sizeBytes: st.size, modified: st.mtime.toISOString(), exists: true };
    } catch {
      return { name, sizeBytes: 0, modified: null, exists: false };
    }
  });
  res.json(files);
});

app.get('/api/workspace/file', (req, res) => {
  const name = req.query.path;
  if (!name || !isValidWorkspaceFile(name)) return res.status(400).json({ error: 'Invalid file path' });
  const fp = path.join(WORKSPACE_DIR, name);
  try {
    const content = require('fs').readFileSync(fp, 'utf-8');
    const st = statSync(fp);
    res.json({ name, content, sizeBytes: st.size, modified: st.mtime.toISOString() });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/workspace/file', (req, res) => {
  const { name, content } = req.body;
  if (!name || !isValidWorkspaceFile(name)) return res.status(400).json({ error: 'Invalid file path' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'Missing content' });
  const fp = path.join(WORKSPACE_DIR, name);
  try {
    require('fs').writeFileSync(fp, content, 'utf-8');
    const st = statSync(fp);
    res.json({ status: 'saved', name, sizeBytes: st.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Panel: Skills Manager ---

const SKILLS_DIRS = [
  { dir: path.join(os.homedir(), 'clawd', 'skills'), type: 'custom' },
  { dir: '/opt/homebrew/lib/node_modules/clawdbot/skills', type: 'built-in' },
];

function parseSkillFrontmatter(content) {
  // Extract YAML frontmatter between --- markers
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (kv) result[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

app.get('/api/skills', (_req, res) => {
  const skills = [];
  for (const { dir, type } of SKILLS_DIRS) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const skillDir = path.join(dir, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const skill = { name: entry.name, type, description: null, hasSkillMd: false };
        if (existsSync(skillMdPath)) {
          skill.hasSkillMd = true;
          try {
            const content = require('fs').readFileSync(skillMdPath, 'utf-8');
            const fm = parseSkillFrontmatter(content);
            if (fm.name) skill.name = fm.name;
            if (fm.description) skill.description = fm.description;
          } catch { /* ignore read errors */ }
        }
        skills.push(skill);
      }
    } catch { /* dir not readable */ }
  }
  res.json(skills);
});

app.get('/api/skills/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return res.status(400).json({ error: 'Invalid skill name' });
  }
  for (const { dir, type } of SKILLS_DIRS) {
    const skillMdPath = path.join(dir, name, 'SKILL.md');
    if (existsSync(skillMdPath)) {
      try {
        const content = require('fs').readFileSync(skillMdPath, 'utf-8');
        return res.json({ name, type, content });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  }
  res.status(404).json({ error: 'Skill not found' });
});

// --- Panel: Corrections Viewer ---

const CORRECTIONS_DIR = path.join(os.homedir(), 'clawd', 'memory', 'corrections');

app.get('/api/corrections', (_req, res) => {
  if (!existsSync(CORRECTIONS_DIR)) return res.json([]);
  try {
    const files = readdirSync(CORRECTIONS_DIR).filter(f => f.endsWith('.md')).sort().reverse();
    const corrections = files.map(f => {
      const fp = path.join(CORRECTIONS_DIR, f);
      const st = statSync(fp);
      return { name: f, sizeBytes: st.size, modified: st.mtime.toISOString() };
    });
    res.json(corrections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/corrections/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return res.status(400).json({ error: 'Invalid file name' });
  }
  const fp = path.join(CORRECTIONS_DIR, name);
  if (!existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try {
    const content = require('fs').readFileSync(fp, 'utf-8');
    res.json({ name, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Panel: Session Manager ---

app.get('/api/sessions/list', (_req, res) => {
  try {
    if (!existsSync(SESSION_DIR)) return res.json([]);
    const files = readdirSync(SESSION_DIR).filter(f => f.endsWith('.jsonl') && !f.includes('.deleted') && !f.includes('.lock'));
    const sessions = files.map(f => {
      const fp = path.join(SESSION_DIR, f);
      const st = statSync(fp);
      return {
        sessionId: f.replace('.jsonl', ''),
        filename: f,
        sizeBytes: st.size,
        lastModified: st.mtime.toISOString(),
        estimatedMessages: Math.round(st.size / 500),
      };
    }).sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Panel: Cron Manager ---

app.get('/api/cron/list', (_req, res) => {
  execFile('clawdbot', ['cron', 'list', '--json'], { timeout: 5000 }, (err, stdout) => {
    if (err) return res.status(502).json({ error: 'clawdbot cron list failed: ' + err.message });
    try {
      const parsed = JSON.parse(stdout);
      res.json(Array.isArray(parsed) ? parsed : parsed.jobs || parsed.crons || []);
    } catch (e) {
      res.status(500).json({ error: 'Parse error: ' + e.message, raw: stdout.slice(0, 500) });
    }
  });
});

app.post('/api/cron/run', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing cron job id' });
  // Sanitize id — only allow alphanumeric, dashes, underscores
  if (!/^[\w-]+$/.test(String(id))) return res.status(400).json({ error: 'Invalid cron job id' });
  execFile('clawdbot', ['cron', 'run', '--id', String(id)], { timeout: 10000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'triggered', id, output: stdout.trim() });
  });
});

// --- Panel: Alerts ---

app.get('/api/alerts', async (_req, res) => {
  const alerts = [];

  // 1. Ollama health
  const ollama = await ollamaFetch('/');
  if (ollama.error) {
    alerts.push({ severity: 'red', title: 'Ollama Unreachable', detail: ollama.error });
  } else {
    alerts.push({ severity: 'green', title: 'Ollama Healthy', detail: 'Responding at ' + config.ollama.url });
  }

  // 2. Database files
  for (const [label, dbPath] of [['memory.db', config.paths.searchDb], ['chat-memory.db', config.paths.chatDb]]) {
    if (!existsSync(dbPath)) {
      alerts.push({ severity: 'red', title: label + ' Missing', detail: 'Expected at ' + dbPath });
    } else {
      const st = statSync(dbPath);
      const sizeMB = (st.size / (1024 * 1024)).toFixed(1);
      if (st.size > 500 * 1024 * 1024) {
        alerts.push({ severity: 'yellow', title: label + ' Large', detail: sizeMB + ' MB — consider cleanup' });
      } else {
        alerts.push({ severity: 'green', title: label + ' OK', detail: sizeMB + ' MB' });
      }
    }
  }

  // 3. Disk space
  await new Promise((resolve) => {
    execFile('/bin/df', ['-g', '/'], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        alerts.push({ severity: 'yellow', title: 'Disk Check Failed', detail: err.message });
      } else {
        const lines = stdout.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          const availGB = parseInt(parts[3]);
          if (!isNaN(availGB)) {
            if (availGB < 10) {
              alerts.push({ severity: 'red', title: 'Disk Space Low', detail: availGB + ' GB free' });
            } else if (availGB < 30) {
              alerts.push({ severity: 'yellow', title: 'Disk Space Moderate', detail: availGB + ' GB free' });
            } else {
              alerts.push({ severity: 'green', title: 'Disk Space OK', detail: availGB + ' GB free' });
            }
          }
        }
      }
      resolve();
    });
  });

  // 4. Context window (from clawdbot status)
  await new Promise((resolve) => {
    execFile('clawdbot', ['status', '--json'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        alerts.push({ severity: 'yellow', title: 'Clawdbot Status Unavailable', detail: err.message });
      } else {
        try {
          const parsed = JSON.parse(stdout);
          const recent = parsed.sessions?.recent?.[0];
          if (recent && recent.percentUsed > 85) {
            alerts.push({ severity: 'red', title: 'Context Window Critical', detail: recent.percentUsed + '% used' });
          } else if (recent && recent.percentUsed > 70) {
            alerts.push({ severity: 'yellow', title: 'Context Window High', detail: recent.percentUsed + '% used' });
          } else if (recent) {
            alerts.push({ severity: 'green', title: 'Context Window OK', detail: (recent.percentUsed || 0) + '% used' });
          }
        } catch { /* ignore parse errors */ }
      }
      resolve();
    });
  });

  res.json(alerts);
});

// --- WebSocket auto-refresh ---

async function broadcastStatus() {
  if (wss.clients.size === 0) return;
  try {
    const [ollama, models, agents] = await Promise.all([
      ollamaFetch('/'),
      ollamaFetch('/api/tags'),
      getAgentSessions().catch(() => []),
    ]);
    const statusMsg = JSON.stringify({
      type: 'status',
      ollama: { healthy: !ollama.error },
      models: models.models || [],
      timestamp: new Date().toISOString(),
    });
    const agentsMsg = JSON.stringify({
      type: 'agents',
      agents,
      timestamp: new Date().toISOString(),
    });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(statusMsg);
        client.send(agentsMsg);
      }
    }
  } catch { /* ignore broadcast errors */ }
}

setInterval(broadcastStatus, 30000);

wss.on('connection', (ws) => {
  broadcastStatus();
  ws.on('error', () => {});
});

// --- start ---

function start() {
  const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    console.log(`\n  localllm dashboard running at http://${HOST}:${PORT}\n`);
    if (HOST === '0.0.0.0') console.log(`  LAN access: http://192.168.1.49:${PORT}\n`);
  });
}

module.exports = { start };

if (require.main === module) start();
