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
