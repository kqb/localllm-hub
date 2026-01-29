# CLAUDE.md — LocalLLM Hub

> Comprehensive project context for AI agents. Read this before making any changes.

## Project Overview

**LocalLLM Hub** is a unified local AI infrastructure for Apple M4 Max (36GB unified memory). It consolidates all local AI capabilities into a single Node.js workspace: embeddings, classification, triage, transcription, semantic search, chat ingestion, and a monitoring dashboard.

**Owner:** Kat (kqb on GitHub)
**Repo:** `github.com:kqb/localllm-hub` (private)
**License:** Private / personal use
**Runtime:** Node.js v25.4.0 on macOS (arm64, Apple Silicon)

---

## Hardware & Environment

| Component | Spec |
|-----------|------|
| Machine | MacBook Pro, Apple M4 Max |
| Memory | 36GB unified (shared CPU/GPU) |
| Available for models | ~27GB after OS overhead |
| Ollama | v0.13.5 at `http://127.0.0.1:11434` |
| Node.js | v25.4.0 |
| SQLite | via `better-sqlite3` (native addon) |
| whisper.cpp | `/opt/homebrew/bin/whisper-cpp` |

**CRITICAL: Always use `127.0.0.1` not `localhost`.** macOS resolves `localhost` to `::1` (IPv6) first. Ollama binds IPv4 only. Using `localhost` causes `HeadersTimeoutError` in Node.js undici.

---

## Directory Structure

```
localllm-hub/
├── cli.js                      # Root CLI (Commander.js, lazy imports)
├── package.json                # npm workspace root
├── config.local.json           # Runtime config overrides (gitignored if sensitive)
├── CLAUDE.md                   # THIS FILE — agent context
├── ARCHITECTURE.md             # Detailed architecture diagrams + package docs
├── INTEGRATION.md              # Clawdbot integration plan
│
├── shared/                     # Shared utilities (NOT a package)
│   ├── ollama.js               #   Single Ollama client wrapper
│   ├── config.js               #   Config with deep-merge overrides from config.local.json
│   └── logger.js               #   Leveled stderr logger (LOG_LEVEL=debug|info|warn|error)
│
├── packages/                   # npm workspaces
│   ├── embeddings/             #   Vector embedding: embed(), batchEmbed(), compare()
│   │   ├── index.js            #     Model: mxbai-embed-large (1024-dim)
│   │   ├── cli.js              #     CLI: embed, batch-embed, compare
│   │   └── package.json
│   │
│   ├── classifier/             #   Email classifier: rules-first, LLM fallback
│   │   ├── index.js            #     classify() → { category, confidence, method }
│   │   ├── rules.js            #     12 rule categories (junk, bills, jobs, etc.)
│   │   ├── llm.js              #     qwen2.5:7b fallback for unknowns
│   │   ├── cli.js
│   │   └── package.json
│   │
│   ├── triage/                 #   Urgency rating (1-5) + local/API routing
│   │   ├── index.js            #     rateUrgency(), routeTask()
│   │   ├── cli.js
│   │   └── package.json
│   │
│   ├── transcriber/            #   whisper.cpp audio transcription
│   │   ├── index.js            #     transcribe(), batchTranscribe()
│   │   ├── cli.js
│   │   └── package.json
│   │
│   ├── search/                 #   Semantic search over markdown files
│   │   ├── index.js            #     search() with cosine similarity
│   │   ├── indexer.js          #     Chunk + embed + SQLite storage
│   │   ├── cli.js              #     search <query>, reindex --source --db
│   │   └── package.json
│   │
│   ├── chat-ingest/            #   Session transcript + Telegram ingestion
│   │   ├── index.js            #     parseTranscriptMessages(), chunkMessages()
│   │   ├── ingest.js           #     Incremental JSONL ingestion → SQLite + embeddings
│   │   ├── watcher.js          #     File watcher for live session ingestion
│   │   ├── telegram.js         #     Telegram export (tdl JSON) parser + ingester
│   │   ├── unified-search.js   #     Cross-source search (memory + chat + telegram)
│   │   ├── search.js           #     Chat-specific search
│   │   ├── cli.js              #     chat ingest, chat search, chat status
│   │   └── package.json
│   │
│   └── dashboard/              #   Web monitoring dashboard
│       ├── server.js           #     Express + WebSocket server (port 3847)
│       ├── public/
│       │   └── index.html      #     Single-page vanilla HTML/CSS/JS dashboard
│       └── package.json
│
├── docs/plans/                 #   Implementation plans
├── test/                       #   Test harness
└── data/                       #   Local data (telegram exports, etc.)
```

---

## Configuration System

**`shared/config.js`** loads defaults then deep-merges overrides from `config.local.json`:

```javascript
const config = {
  models: {
    triage: 'qwen2.5:7b',          // Fast classification + urgency
    code: 'qwen2.5-coder:32b',     // Code tasks (19GB, loads on demand)
    reasoning: 'deepseek-r1:32b',  // Complex reasoning (19GB, loads on demand)
    embed: 'mxbai-embed-large',    // Primary embeddings (1024-dim, 669MB)
    embedFast: 'nomic-embed-text', // Fallback embeddings (768-dim, 274MB)
  },
  thresholds: {
    confidence: 0.8,    // Above = auto-handle, below = escalate to API
    urgency: 3,         // Alert threshold (1-5 scale)
  },
  paths: {
    memoryDir: '~/clawd/memory',
    emailDb: '~/Projects/emailctl/emails.db',
    searchDb: '~/clawd/scripts/memory.db',
    chatDb: '~/clawd/scripts/chat-memory.db',
    sessionsDir: '~/.clawdbot/agents/main/sessions',
  },
  ollama: {
    url: 'http://127.0.0.1:11434',   // MUST be 127.0.0.1, NOT localhost
    timeout: 30000,
  },
  embedding: {
    dimension: 1024,
    chunkSize: 500,     // chars per chunk
    chunkOverlap: 100,  // overlap between chunks
  },
  watcher: {
    pollInterval: 5000,   // ms between file checks
    debounce: 2000,       // ms debounce after file change
    newFileScan: 30000,   // ms between scans for new files
  },
};
```

**To override at runtime:** Create/edit `config.local.json` in project root. Only include keys you want to change — they deep-merge with defaults.

---

## Ollama Model Budget

Only 1-2 models fit in memory simultaneously (~27GB available):

| Model | Size | Use Case | Notes |
|-------|------|----------|-------|
| mxbai-embed-large | 669MB | Embeddings (1024-dim) | Always-on for search |
| qwen2.5:7b | 4.7GB | Classification, triage, urgency | Fast inference |
| nomic-embed-text | 274MB | Fallback embeddings (768-dim) | Lighter alternative |
| qwen2.5-coder:32b | 19GB | Code tasks | Loads on demand, unloads others |
| deepseek-r1:32b | 19GB | Complex reasoning | Loads on demand, unloads others |

**Auto-unload:** Ollama unloads models after 5min idle (`OLLAMA_KEEP_ALIVE=5m`).
**Concurrency:** Avoid parallel inference with different models — causes model swapping thrash.
**Health check:** `curl -s --max-time 3 http://127.0.0.1:11434/` before batch operations.

---

## Package Details

### embeddings (`packages/embeddings/`)

Generates and compares vector embeddings via Ollama.

```javascript
const { embed, batchEmbed, compare } = require('@localllm/embeddings');
const vector = await embed('hello world');         // Float64Array[1024]
const sim = await compare('cat', 'dog');           // 0.0 - 1.0 (cosine)
```

- Returns raw float arrays for composability
- Cosine similarity computed locally (no Ollama roundtrip for comparison)
- Batch embedding sends all texts in single request

### classifier (`packages/classifier/`)

Two-tier email classification: O(1) rules first → LLM fallback for unknowns.

```javascript
const { classify } = require('@localllm/classifier');
const result = await classify({ from: 'noreply@github.com', subject: 'PR merged', body: '...' });
// → { category: 'notifications', confidence: 1.0, method: 'rules' }
```

- **12 rule categories:** junk, bills, jobs, finance, health, legal, travel, shopping, subscriptions, newsletters, notifications, personal
- Rules: domain patterns, subject regex, body keywords. First match wins.
- LLM fallback: qwen2.5:7b with structured JSON prompt. 2-5s latency.
- Expected rule hit rate: ~80%

### triage (`packages/triage/`)

Urgency rating + local vs API routing decisions.

```javascript
const { rateUrgency, routeTask } = require('@localllm/triage');
const { urgency, reasoning } = await rateUrgency('server is down');
// → { urgency: 4, reasoning: "..." }
const { route } = await routeTask('translate this paragraph');
// → { route: "local", confidence: 0.9 }
```

- Urgency 1-5 scale (1=can wait days, 5=immediate)
- Route: "local" (Ollama) or "api" (Claude API)
- Model: qwen2.5:7b

### search (`packages/search/`)

Semantic search over markdown files using embeddings + SQLite.

- **Chunking:** 500 chars max, 100 char overlap, split on markdown headers
- **Storage:** Float32 BLOBs in SQLite (4KB per chunk at 1024 dimensions)
- **Query:** Embed query → cosine similarity against all chunks → top-k results
- **DB:** `~/clawd/scripts/memory.db`
- **Performance:** ~500ms query over 390 chunks, ~60s full reindex

```sql
-- Schema
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL, start_line INTEGER, end_line INTEGER,
  text TEXT NOT NULL, embedding BLOB,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### transcriber (`packages/transcriber/`)

Audio transcription via whisper.cpp (no Python, no API key).

- Formats: .m4a .wav .mp3 .mp4 .ogg .flac
- Uses `execFile` (not `exec`) — prevents shell injection
- Batch mode: sequential processing, per-file error handling

### chat-ingest (`packages/chat-ingest/`)

Ingests Clawdbot session transcripts and Telegram exports into searchable SQLite.

**Session JSONL format** (each line):
```json
{
  "type": "message",
  "id": "uuid",
  "parentId": "uuid",
  "timestamp": "ISO-8601",
  "message": {
    "role": "user|assistant|toolResult",
    "content": "string" | [
      { "type": "text", "text": "..." },
      { "type": "thinking", "thinking": "...", "thinkingSignature": "..." },
      { "type": "toolCall", "id": "...", "name": "tool_name", "arguments": {...} },
      { "type": "image", ... }
    ],
    "model": "claude-opus-4-5",
    "provider": "anthropic",
    "usage": { "inputTokens": N, "outputTokens": N },
    "stopReason": "toolUse|endTurn",
    "timestamp": "ISO-8601"
  }
}
```

For `role=toolResult`:
```json
{
  "role": "toolResult",
  "content": [{ "type": "text", "text": "..." }],
  "toolCallId": "uuid",
  "toolName": "exec",
  "isError": false,
  "details": { ... }
}
```

**Incremental ingestion:** Tracks file offset in `ingest_progress` table. On re-run, only processes new lines.

**Watcher:** File-level polling (configurable interval), debounced, auto-discovers new .jsonl files.

**Telegram ingestion:** Parses `tdl` export JSON, chunks by conversation windows, embeds, stores in `telegram_chunks` table.

**Unified search:** `unified-search.js` searches across memory, chat, and telegram sources simultaneously.

```sql
-- chat-memory.db schema
CREATE TABLE chat_chunks (
  id INTEGER PRIMARY KEY, session_id TEXT, file TEXT,
  start_ts TEXT, end_ts TEXT, text TEXT, embedding BLOB
);
CREATE TABLE ingest_progress (file TEXT PRIMARY KEY, last_offset INTEGER, last_timestamp TEXT, chunk_count INTEGER);
CREATE TABLE telegram_chunks (id INTEGER PRIMARY KEY, chat_id TEXT, start_ts TEXT, end_ts TEXT, text TEXT, embedding BLOB);
```

### dashboard (`packages/dashboard/`)

Real-time web monitoring dashboard. Express + WebSocket + vanilla JS.

**URL:** `http://localhost:3847` (LAN: `http://192.168.1.49:3847`)
**Start:** `cd ~/Projects/localllm-hub && node cli.js dashboard`

#### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Ollama health + DB stats |
| GET | `/api/models` | Loaded Ollama models |
| GET | `/api/search?q=&sources=&topk=` | Unified semantic search |
| POST | `/api/reindex` | Trigger memory reindex |
| GET | `/api/packages` | Package health grid |
| GET | `/api/jobs` | Ingestion stats (chat chunks, progress, telegram) |
| GET | `/api/daemons` | Launchd daemon status |
| GET | `/api/daemons/:label/logs` | Daemon log files |
| POST | `/api/daemons/:label/restart` | Restart a daemon |
| GET | `/api/memory` | Memory file contents |
| GET | `/api/clawdbot/config` | Clawdbot gateway config |
| POST | `/api/clawdbot/config` | Update Clawdbot config |
| GET | `/api/config` | LocalLLM config |
| POST | `/api/config` | Update LocalLLM config (writes config.local.json) |
| GET | `/api/context-monitor` | Context window stats (shells to `clawdbot status --json`) |
| GET | `/api/agents` | Active Clawdbot + tmux sessions |
| GET | `/api/agents/:key/log?kind=` | Session output (clawdbot history or tmux capture-pane) |
| POST | `/api/agents/:key/send?kind=` | Send input to session |
| GET | `/api/chat/sessions` | List JSONL session files |
| GET | `/api/chat/:id/messages?offset=&limit=` | Paginated conversation history |
| GET | `/api/chat/:id/messages/stream?last=` | Tail last N messages |

#### WebSocket

Broadcasts every 30s:
- `type: "status"` — Ollama health + loaded models
- `type: "agents"` — Active agent session list

#### Frontend Panels (single-page `index.html`)

1. **Status + Models** — Ollama health, loaded models grid
2. **📊 Context Monitor** — Context window progress bar (color-coded green/yellow/red), injected file token costs, memory footprint, auto-refresh 30s
3. **🤖 Agent Monitor** — Clawdbot + tmux session list with status dots (green=active, yellow=idle, red=stale), click to expand live output viewer (5s refresh), input bar to send commands
4. **💬 Conversation** — Full chat history with session selector, toggle buttons for 🧠 Thinking / 🔧 Tools / 📊 Usage, collapsible thinking blocks, expandable tool call arguments, markdown rendering, pagination (load more), live tail (5s polling)
5. **🔍 Semantic Search** — Multi-source search with sliders and source toggles
6. **Jobs** — Ingestion stats (chat chunks, telegram chunks, progress)
7. **Clawdbot Config** — Editable gateway config (writes to clawdbot.json)
8. **Memory Config** — Editable localllm config (writes to config.local.json)
9. **Daemons** — Launchd service status with log viewers + restart buttons
10. **Packages** — Health grid for all localllm packages

#### Dashboard Architecture Patterns

- **Backend:** Express routes return JSON, use `execFile` (not `exec`) for shell commands with timeouts
- **Frontend:** Vanilla JS, `$()` helper for `document.getElementById`, `escHtml()` for XSS defense
- **Style:** Dark theme, CSS variables (`--bg`, `--bg2`, `--bg3`, `--text`, `--text2`, `--accent`, `--green`, `--yellow`, `--red`, `--border`, `--radius`)
- **Cards:** Each panel is `<section class="card" id="X-card"><h2>Title</h2><div id="X-content">Loading...</div></section>`
- **Data display:** `.kv` class for key-value rows, `.stat` for stat boxes, `.badge` for labels
- **Init:** `(async () => { await Promise.all([loadX(), loadY(), ...]); connectWs(); setInterval(...); })()`
- **Refresh:** setInterval per panel (context 30s, agents 10s, status 60s), WebSocket for live updates
- **Caching:** JSONL parser caches parsed messages by file mtime (`_chatCache` Map)

---

## CLI Commands

All via `node cli.js <command>` or `localllm <command>` (if linked):

| Command | Package | Ollama? | Description |
|---------|---------|---------|-------------|
| `embed <text>` | embeddings | ✅ | Generate embedding vector |
| `batch-embed <texts...>` | embeddings | ✅ | Batch embed multiple texts |
| `compare <a> <b>` | embeddings | ✅ | Cosine similarity between texts |
| `classify --from --subject --body` | classifier | Maybe | Classify email (rules first) |
| `triage <text>` | triage | ✅ | Rate urgency 1-5 |
| `route <text>` | triage | ✅ | Decide local vs API routing |
| `search <query>` | search | ✅ | Semantic search over memory |
| `reindex --source --db` | search | ✅ | Rebuild search index |
| `transcribe <file>` | transcriber | ❌ | Transcribe audio file |
| `transcribe-batch <dir>` | transcriber | ❌ | Batch transcribe directory |
| `chat ingest` | chat-ingest | ✅ | Ingest session transcripts |
| `chat search <query>` | chat-ingest | ✅ | Search chat history |
| `chat search-all <query>` | chat-ingest | ✅ | Unified cross-source search |
| `chat status` | chat-ingest | ❌ | Show indexing stats |
| `dashboard` | dashboard | ❌ | Start web dashboard (port 3847) |

---

## Clawdbot Integration

LocalLLM Hub is the local AI backend for **Clawdbot (Zoid)** — a personal AI assistant.

**Clawdbot workspace:** `~/clawd/`
**Clawdbot sessions:** `~/.clawdbot/agents/main/sessions/*.jsonl`
**Clawdbot config:** `~/.clawdbot/gateway/clawdbot.json`

### How They Connect

1. **Memory search:** Clawdbot's `memory_search` tool uses localllm-hub embeddings via `~/clawd/scripts/semantic-search.js` which queries `memory.db`
2. **Chat search:** Unified search across memory + chat transcripts + Telegram via `chat-memory.db`
3. **Dashboard:** Monitors Clawdbot's context window, sessions, and conversation history by reading JSONL files and shelling out to `clawdbot status --json`
4. **Config editing:** Dashboard can read/write Clawdbot gateway config
5. **Agent monitoring:** Dashboard lists Clawdbot + tmux sessions, captures output, sends commands

### Launchd Services

| Label | Description | Logs |
|-------|-------------|------|
| `com.localllm.chat-ingest` | Auto-indexes new session messages | `~/.clawdbot/logs/chat-ingest.{log,err}` |

---

## Database Files

| Path | Engine | Contents |
|------|--------|----------|
| `~/clawd/scripts/memory.db` | SQLite | Memory file chunks + embeddings (search package) |
| `~/clawd/scripts/chat-memory.db` | SQLite | Chat transcript chunks + Telegram chunks + embeddings |

### Embedding Storage Format

Embeddings stored as Float32 BLOBs (4 bytes per dimension):
```javascript
// Write: Float64Array → Float32 buffer (1024 × 4 = 4KB per chunk)
const buffer = Buffer.alloc(embedding.length * 4);
for (let i = 0; i < embedding.length; i++) buffer.writeFloatLE(embedding[i], i * 4);

// Read: buffer → Float64Array
const embedding = [];
for (let i = 0; i < buffer.length; i += 4) embedding.push(buffer.readFloatLE(i));
```

**Context limit:** mxbai-embed-large has 512 token context. Text is truncated to 1500 chars, with fallback to 800 chars if embedding fails.

---

## Known Issues & Gotchas

### Must-Know

1. **`127.0.0.1` not `localhost`** — IPv6 resolution breaks Ollama connection on macOS
2. **`execFile` not `exec`** — All shell commands use `execFile` with argument arrays for security
3. **Model memory budget** — Only 1-2 models fit in 27GB. Large models (32B) evict others
4. **Embedding context limit** — mxbai-embed-large: 512 tokens. Truncate long text before embedding
5. **JSONL files can be huge** — Current session is 3MB+, 736+ messages. Always paginate, never load all at once
6. **Dashboard security hook** — A pre-tool-use hook blocks `innerHTML` edits during Claude Code sessions. The dashboard is localhost-only admin tool; use `escHtml()` for defense-in-depth and document the safety rationale in comments near innerHTML usage

### Ollama Quirks

- **Freeze under load:** Concurrent model pulls + inference can freeze Ollama. Sequential operations only.
- **First-load latency:** 2-8s to load model weights into GPU memory after unload
- **Health check:** `curl -s --max-time 3 http://127.0.0.1:11434/` before batch ops

### Build & Install

```bash
cd ~/Projects/localllm-hub
npm install                    # Installs all workspace dependencies
node cli.js --help             # Verify CLI works
node cli.js dashboard          # Start dashboard
```

No Python dependencies. No Docker. Everything runs natively on macOS with Node.js + Ollama + whisper.cpp.

---

## Development Patterns

### Adding a New Package

1. Create `packages/<name>/` with `package.json`, `index.js`, `cli.js`
2. Add workspace reference in root `package.json` (automatic via `"workspaces": ["packages/*"]`)
3. Import shared utilities: `require('../../shared/ollama')`, `require('../../shared/config')`
4. Add CLI subcommand in root `cli.js` with lazy import
5. **Add dashboard panel** — API endpoint + UI card (see below). THIS IS NOT OPTIONAL.
6. Run `npm install` from root to link workspace

### Adding a Dashboard Panel

Every new feature MUST include a dashboard panel. Follow this checklist:

1. **Backend API:** Add `app.get('/api/<endpoint>')` route in `server.js`. For editable config, add matching `app.post('/api/<endpoint>')`.
2. **HTML Card:** Add `<section class="card" id="<name>-card"><h2>Title</h2><div id="<name>-content">Loading...</div></section>` in `index.html`
3. **CSS:** Add styles in `<style>` block. Use existing CSS variables (`--bg`, `--bg2`, `--bg3`, `--text`, `--text2`, `--accent`, `--green`, `--yellow`, `--red`, `--border`, `--radius`). Use existing classes (`.card`, `.kv`, `.stat`, `.badge`, `.btn`).
4. **JS Loader:** Add `async function load<Name>() { ... }` that fetches API and renders. Use `escHtml()` for all text content. Use `$()` helper for getElementById.
5. **Init:** Add to `Promise.all([..., load<Name>()])` in init block
6. **Refresh:** Add `setInterval(load<Name>, <ms>)` if auto-refresh needed
7. **Config UI:** If the feature has settings, add form controls (inputs, selects, toggles) with save buttons that POST to the API
8. **Feedback:** Show success/error toast or status indicator after saves
9. **Document:** Update this CLAUDE.md with the new panel, API endpoints, and config fields

### Testing

```bash
# Verify all packages load
npm run verify

# Test individual commands
node cli.js embed "test"
node cli.js search "test query"
node cli.js chat status

# Test dashboard API
curl -s http://localhost:3847/api/status | jq .
curl -s http://localhost:3847/api/context-monitor | jq .
curl -s http://localhost:3847/api/agents | jq .
curl -s http://localhost:3847/api/chat/sessions | jq .
```

---

## Optimization Plan (AgentOS Architecture)

This project is the "body" of a Multi-Agent System where Claude is the executive brain and the M4 Max provides memory, ears, and routing. These optimizations maximize that architecture.

### 1. RAG Quality: Concept-Level Chunking

**Current:** 500 char chunks, 100 overlap — produces sentence fragments that force Claude to guess connections.
**Target:** 1500 char chunks, 300 overlap — gives Claude full concept blocks (entire functions, config sections, decision threads).

```javascript
// config change needed:
embedding: {
  dimension: 1024,
  chunkSize: 1500,     // was 500
  chunkOverlap: 300,   // was 100
}
```

**Why:** Claude Opus excels at synthesis. Feed it 2 large contextual blocks > 5 tiny snippets. The extra embedding cost is negligible; the reasoning quality improvement is massive.

**After changing:** Run `node cli.js reindex` to rebuild all search indices with new chunk sizes.

### 2. Model Budget: Downsize for Breathing Room

**Current:** qwen2.5-coder:32b (19GB) + deepseek-r1:32b (19GB) — can't coexist, causes thrash.
**Target:** Downsize to 14B variants (~9GB each), freeing ~10GB for always-loaded services.

| Model | Size | Role | Status |
|-------|------|------|--------|
| mxbai-embed-large | 669MB | Embeddings | Always loaded |
| qwen2.5:7b | 4.7GB | Router + Triage | Always loaded |
| qwen2.5-coder:14b | ~9GB | Code tasks | On-demand |
| deepseek-r1:14b | ~9GB | Complex reasoning | On-demand |

**Breathing room needed for:**
- Vector DB cache in RAM (0.1s queries vs 5s disk reads)
- Chat ingest watcher daemon (background JSONL parsing)
- Router model always warm (instant triage, no cold-start)

### 3. Route Switching: Triage Module Activation

The triage package exists but isn't wired into Clawdbot. Activate it to route prompts to the cheapest capable model.

**Three routing buckets:**

| Bucket | Intent Signals | Routed To | Cost |
|--------|---------------|-----------|------|
| **High Ops** | Architect, refactor, debug complex, security audit, multi-file | Claude Opus | $$$ |
| **Low Ops** | Draft email, fix typo, summarize, simple Q&A, translate | Sonnet / Haiku / Gemini Flash | $ |
| **Local Ops** | Search notes, list files, classify email, rate urgency | Qwen 7B (local) | Free |

**Implementation:** Qwen 7B classifies every incoming prompt → JSON output `{"route": "high_ops"|"low_ops"|"local_ops", "reason": "..."}` → Clawdbot routes to appropriate model.

**Latency budget:** ~100ms for local classification. Saves $0.50+ per simple query redirected away from Opus.

### 4. Librarian Pre-Fetch (Don't Make Claude Search)

Claude is too expensive to be a search engine. Use a local "Librarian" agent to pre-fetch context.

**Current flow:**
```
User query → Claude → memory_search tool call → results → Claude reasons
(2 Claude roundtrips, search burns Opus tokens)
```

**Optimized flow:**
```
User query → Qwen 7B (local) → semantic search + grep → inject context → Claude reasons
(1 Claude roundtrip, search is free)
```

**Implementation:** Before sending to Claude, local Librarian:
1. Runs semantic search across memory + chat + telegram
2. Greps relevant files for keywords
3. Injects top results into the Claude prompt as pre-fetched context
4. Claude just reads and reasons — never calls search tools

### 5. Context Window Hygiene (200k Hard Limit)

Claude's 200k is a hard wall (400 error at 200,001). Manage it aggressively.

**Flush trigger:** 190k (95%). Keep 10k buffer for model output (reasoning chain + code).

**Context structure:**
- **Static block (cached):** AGENTS.md + TOOLS.md + MEMORY.md (~7k tokens, cached by Anthropic)
- **Dynamic block:** Recent chat history + user query + pre-fetched context

**Compaction strategy:** Clawdbot handles automatic compaction. Prevent bloat by:
- Truncating long tool results (500 char max in context, full result in separate retrieval)
- Not re-injecting entire file contents when a summary suffices
- Moving resolved topics to MEMORY.md proactively

---

## Future Roadmap

- [ ] **Activate route switching** — Wire triage into Clawdbot prompt pipeline
- [ ] **Librarian agent** — Pre-fetch context before Claude calls
- [ ] **Chunk size migration** — Increase to 1500 chars, reindex all sources
- [ ] **Model downsize** — Pull 14B variants, update config, test quality
- [ ] **Always-warm router** — Keep Qwen 7B loaded via OLLAMA_KEEP_ALIVE or preload cron
- [ ] HTTP API server mode (expose localllm-hub as REST for non-Node consumers)
- [ ] Embedding cache (skip re-embedding unchanged files on reindex)
- [ ] Streaming mode for long-running generate/chat operations
- [ ] Metrics endpoint (latency/throughput stats)
- [ ] Email triage pipeline (classify → urgency → route → notify)
- [ ] Voice memo ingestion pipeline (transcribe → embed → search)

---

## Dashboard UX: Unified Control Center

The dashboard (`http://localhost:3847`, LAN: `http://192.168.1.49:3847`) is the **single pane of glass** for the entire AgentOS stack. It enables super users to monitor, configure, and harness the full potential of their local models without touching config files or CLI.

### Current Panels (10)

| Panel | Purpose | Refresh |
|-------|---------|---------|
| **Status + Models** | Ollama health, loaded models with sizes | 30s WS |
| **📊 Context Monitor** | Context window gauge (color-coded), injected file token costs, memory footprint | 30s |
| **🤖 Agent Monitor** | Live sessions (Clawdbot + tmux), status dots, click-to-expand terminal output, send commands | 10s + 5s output |
| **💬 Conversation** | Full chat history with 🧠 Thinking / 🔧 Tools / 📊 Usage toggles, pagination, live tail | 5s tail |
| **🔍 Semantic Search** | Multi-source search (memory + chat + telegram) with source toggles and relevance sliders | Manual |
| **Jobs** | Ingestion stats: chat chunks indexed, telegram messages, progress tracking | 60s |
| **Clawdbot Config** | Live-edit Clawdbot gateway config (writes to `~/.clawdbot/clawdbot.json`) | Manual |
| **Memory Config** | Live-edit LocalLLM config (writes to `config.local.json`) | Manual |
| **Daemons** | Launchd service status, log viewers, restart buttons | 60s |
| **Packages** | Health grid for all localllm packages | 60s |

### Planned Dashboard Panels (All Required)

Every configurable aspect of the system MUST have a UI panel. Status → Config → Test → Deploy, all from the browser.

**Model Management:**
- [ ] **Model Manager** — Pull/remove/update Ollama models from UI. Show VRAM usage, loaded vs cold status, model sizes. Warm/unload buttons. Set `OLLAMA_KEEP_ALIVE` per model.
- [ ] **Model Budget Visualizer** — 36GB memory bar showing OS overhead, loaded models, available headroom. Warn when approaching limits.

**Routing & Triage:**
- [ ] **Route Switcher** — Configure triage buckets (high/low/local ops), edit intent detectors, map to models. Test panel: type a prompt → see which bucket it routes to + why. Cost savings tracker.
- [ ] **Router Prompt Editor** — Edit the Qwen 7B router prompt template. Test with sample inputs. See JSON routing output.

**RAG & Search:**
- [ ] **RAG Inspector** — Browse indexed chunks with source/line refs. Test search queries → see relevance scores. Chunk size/overlap sliders with live reindex preview. Compare old vs new chunking.
- [ ] **Embedding Explorer** — Visualize embedding space (2D projection). See which memories cluster together. Find gaps in coverage.

**Context & Cost:**
- [ ] **Token Economics** — Cost per session, per model. Savings from local routing. Daily/weekly/monthly trends. Budget alerts.
- [ ] **Compaction Settings** — Edit flush threshold (currently 180k), flush prompt, reserve floor. Preview what gets flushed.

**Agent Behavior:**
- [ ] **Prompt Editor** — Edit AGENTS.md, SOUL.md, USER.md, HEARTBEAT.md, IDENTITY.md from dashboard with live preview of token cost. Syntax highlighting for markdown. Save triggers gateway restart.
- [ ] **Skills Manager** — Browse installed skills (33+), enable/disable, view SKILL.md, install from ClawdHub. Show which skills are triggered most often.
- [ ] **Corrections Viewer** — Browse memory/corrections/ files. See behavioral corrections over time. Mark as resolved/active.

**System:**
- [ ] **Alerts & Notifications** — Context window warnings, model OOM alerts, daemon failures, ingestion errors. Configurable thresholds from UI.
- [ ] **Clawdbot Config Editor** — Full clawdbot.json editor: model selection, thinking level, memory search settings, channel configs, heartbeat intervals. Validated JSON with schema hints.
- [ ] **Session Manager** — Browse all sessions, view/delete old transcripts, see token usage per session, export conversations.
- [ ] **Cron Manager** — View/add/edit/delete cron jobs. See run history. Test fire manually.

### Design Principles

- **Dashboard-first:** Every feature, config, and capability MUST have a dashboard UI. If a user can't do it from the browser, it's not done. CLI and config files are implementation details — the dashboard is the product.
- **Localhost-only admin tool** — No auth required on loopback. LAN access for mobile monitoring.
- **Single-page vanilla HTML/CSS/JS** — No build step, no framework. Copy-paste deployable.
- **Dark theme** — CSS variables for consistent styling across all panels.
- **Real-time** — WebSocket for push updates, polling for panel-specific data.
- **Progressive disclosure** — Overview first, click to expand details (agent output, tool arguments, thinking blocks).
- **Full customizability** — Every config value, threshold, model selection, and behavior rule must be editable from the dashboard. No SSH-only settings.

### The Dashboard-First Rule (MANDATORY)

**Every feature built for this project MUST include a dashboard UI component.** This is non-negotiable.

When building ANY new capability:
1. **Backend:** Add API endpoint(s) to `server.js`
2. **Frontend:** Add a dashboard panel/card to `index.html`
3. **Config:** If configurable, add GET + POST endpoints and UI controls (inputs, toggles, dropdowns)
4. **Status:** If it has state, show it in the dashboard with real-time updates

**Examples of what this means:**
- Adding a new model? → Dashboard model manager lets you pull/remove/warm models
- Adding route switching? → Dashboard shows routing decisions, lets you configure buckets
- Changing chunk size? → Dashboard has a slider, shows before/after search quality
- New daemon? → Dashboard shows its status, logs, restart button
- New triage rule? → Dashboard has a rule editor with test inputs

**If it's config-file-only, it's not shipped.** The dashboard IS the product.

---

## Clawdbot Configuration & Behavior (Agent Reference)

Agents working on this project need to understand how Clawdbot is configured and where to make changes. This section maps every configurable aspect.

### File Map: Where Everything Lives

```
~/.clawdbot/                              # Clawdbot runtime data
├── clawdbot.json                         # ★ MAIN CONFIG — gateway, channels, agents, auth
├── clawdbot.json.bak                     # Auto-backup before config changes
├── agents/
│   └── main/
│       ├── agent/
│       │   └── auth-profiles.json        # OAuth/API key profiles
│       └── sessions/
│           ├── <uuid>.jsonl              # Conversation transcripts (one per session)
│           └── <uuid>.jsonl.lock         # Session locks
├── browser/
│   └── clawd/                            # Isolated browser profile for automation
├── bin/                                  # Clawdbot binaries
└── logs/
    └── chat-ingest.{log,err}             # Ingestion daemon logs

~/clawd/                                  # ★ AGENT WORKSPACE — Zoid's home
├── AGENTS.md                             # ★ Agent behavior rules, orchestration patterns
├── SOUL.md                               # ★ Personality, tone, boundaries
├── USER.md                               # ★ User profile (Kat — engineer, CST timezone)
├── IDENTITY.md                           # Name (Zoid), emoji (🦑), creature type
├── TOOLS.md                              # Tool-specific notes (cameras, SSH, TTS, scripts)
├── HEARTBEAT.md                          # Heartbeat checklist (what to check on wake)
├── MEMORY.md                             # ★ Long-term curated memory (distilled insights)
├── CONTEXT_TODAY.md                      # Auto-generated daily corrections + focus areas
├── memory/                               # Daily memory logs
│   ├── YYYY-MM-DD.md                     # Raw daily notes (one per day)
│   └── corrections/
│       └── YYYY-MM-DD-<slug>.md          # Behavioral corrections
├── scripts/                              # Utility scripts (monitors, search, context gen)
│   ├── semantic-search.js                # Memory search (SQLite + embeddings)
│   ├── generate-context.sh               # Regenerates CONTEXT_TODAY.md
│   ├── context-monitor.sh                # CLI context window monitor
│   ├── claude-watcher.js                 # VSCode Claude instance monitor
│   ├── claude-usage-guardian.sh          # Usage tracking with auto-pause
│   └── session-continuity.js             # Cross-session task tracking
├── skills/                               # 33+ installed skills (AgentSkill format)
│   ├── claude-code-wingman/              # ★ Spawn Claude Code in tmux
│   ├── coding-orchestration/             # Multi-agent coding workflows
│   ├── gog/                              # Google Workspace CLI
│   ├── github/                           # GitHub CLI patterns
│   ├── weather/                          # Weather lookups
│   └── ...                               # 28+ more skills
├── docs/                                 # Agent documentation
│   ├── orchestrating-coding-agents.md
│   └── ui-validation-guide.md
└── data/                                 # Local data exports
    └── telegram/                         # Telegram chat exports

/opt/homebrew/lib/node_modules/clawdbot/  # Clawdbot installation (npm global)
├── skills/                               # Built-in skills (30+)
│   ├── 1password/
│   ├── apple-notes/
│   ├── bear-notes/
│   ├── spotify-player/
│   └── ...
└── ...

~/Projects/localllm-hub/                  # ★ THIS PROJECT — local AI infrastructure
├── CLAUDE.md                             # THIS FILE
├── config.local.json                     # Runtime config overrides
└── packages/dashboard/                   # Monitoring dashboard
```

### clawdbot.json: Main Configuration

Location: `~/.clawdbot/clawdbot.json`
Edit via: Dashboard UI (`/api/clawdbot/config`) or `clawdbot gateway config.patch`

#### Key Sections

**`agents.defaults`** — Controls model, thinking, memory, compaction:
```jsonc
{
  "model": { "primary": "anthropic/claude-opus-4-5" },
  "models": {
    "anthropic/claude-opus-4-5": { "alias": "opus" },
    "anthropic/claude-sonnet-4-5": { "alias": "sonnet" }
  },
  "workspace": "/Users/yuzucchi/clawd",          // Agent workspace root
  "thinkingDefault": "high",                      // Reasoning level: off|low|high
  "verboseDefault": "full",                       // Tool output verbosity
  "maxConcurrent": 4,                             // Max concurrent tool calls
  "subagents": { "maxConcurrent": 8 },            // Max spawned sub-agents
  "typingMode": "thinking",                       // Show typing indicator during thinking
  "heartbeat": { "includeReasoning": true },      // Include reasoning in heartbeat responses

  "memorySearch": {
    "enabled": true,
    "sources": ["memory", "sessions"],
    "provider": "openai",                         // Uses OpenAI-compatible API (Ollama)
    "remote": {
      "baseUrl": "http://127.0.0.1:11434/v1",    // Ollama OpenAI-compat endpoint
      "apiKey": "ollama"
    },
    "fallback": "local",                          // Fallback to local embeddings
    "model": "mxbai-embed-large",                 // Embedding model (1024-dim)
    "store": { "vector": { "enabled": true } },
    "sync": { "watch": true },                    // Watch memory files for changes
    "query": { "hybrid": { "enabled": true } },   // Hybrid keyword + vector search
    "cache": { "enabled": true }
  },

  "compaction": {
    "reserveTokensFloor": 10000,                  // Always keep 10k tokens free
    "memoryFlush": {
      "enabled": true,
      "softThresholdTokens": 180000,              // Trigger flush at 180k/200k (90%)
      "prompt": "...",                             // Flush prompt (instructs agent to save context)
      "systemPrompt": "..."                        // System message for flush
    }
  }
}
```

**`channels`** — Messaging surfaces:
```jsonc
{
  "telegram": { /* bot token, chat IDs, reaction config */ },
  "imessage": { /* iMessage bridge config */ }
}
```

**`gateway`** — Network settings:
```jsonc
{
  "port": 18789,
  "mode": "local",
  "bind": "loopback",
  "controlUi": { "enabled": true },
  "auth": { "mode": "password", "token": "...", "password": "..." }
}
```

**`hooks`** — Internal event hooks:
```jsonc
{
  "internal": {
    "entries": {
      "boot-md": { "enabled": true },           // Load workspace .md files on boot
      "command-logger": { "enabled": true },     // Log tool calls
      "session-memory": { "enabled": true }      // Persist session memory
    }
  }
}
```

**`cron`** — Scheduled tasks: `{ "enabled": true }`

### Workspace Files: Agent Behavior

These files are **injected into every Claude session** as context (~7k tokens total):

| File | Purpose | Edit When |
|------|---------|-----------|
| `AGENTS.md` | ★ Master behavior rules, orchestration patterns, code task rules, validation checklist | Adding new behavioral rules or patterns |
| `SOUL.md` | Personality, tone, boundaries, core truths | Changing agent persona or communication style |
| `USER.md` | User profile (name, timezone, working style, preferences) | Updating user preferences |
| `IDENTITY.md` | Agent name (Zoid), emoji (🦑), creature type | Changing agent identity |
| `TOOLS.md` | Tool-specific notes, camera names, SSH hosts, script docs | Adding new tools or environment info |
| `HEARTBEAT.md` | What to check during heartbeat polls (agents, emails, follow-ups) | Changing periodic monitoring tasks |
| `MEMORY.md` | Long-term curated memory (decisions, lessons, key context) | Agent updates this itself during compaction |

**⚠️ Token budget:** These files cost ~7k tokens combined. Every byte counts against the 200k window. Keep them lean — move verbose content to memory/ files that are retrieved on demand via semantic search.

### Skills: Extending Agent Capabilities

**Installed skills (33+):** `~/clawd/skills/`
**Built-in skills (30+):** `/opt/homebrew/lib/node_modules/clawdbot/skills/`

Each skill has a `SKILL.md` that the agent reads on demand when a matching task is detected.

Key custom skills:
| Skill | Purpose |
|-------|---------|
| `claude-code-wingman` | Spawn Claude Code in tmux (uses work API, saves budget) |
| `coding-orchestration` | Multi-agent coding with git worktrees |
| `self-improving-agent` | Captures learnings, errors, corrections |
| `local-llm-optimization` | Model selection guide for M4 Max |
| `clawdbot-cron` | Scheduled tasks and reminders |
| `agent-development` | Creating new agent configurations |

### How to Modify Agent Behavior

**Dashboard is always the primary interface.** Files listed for agent/developer reference — users should never need to edit files directly.

| Want to change... | Dashboard Panel | Backing File | Field |
|---|---|---|---|
| Default model | Clawdbot Config | `~/.clawdbot/clawdbot.json` | `agents.defaults.model.primary` |
| Thinking level | Clawdbot Config | `~/.clawdbot/clawdbot.json` | `agents.defaults.thinkingDefault` (`off`/`low`/`high`) |
| Memory search | Clawdbot Config | `~/.clawdbot/clawdbot.json` | `agents.defaults.memorySearch.*` |
| Compaction threshold | Compaction Settings | `~/.clawdbot/clawdbot.json` | `agents.defaults.compaction.softThresholdTokens` |
| Flush prompt | Compaction Settings | `~/.clawdbot/clawdbot.json` | `agents.defaults.compaction.memoryFlush.prompt` |
| Agent personality | Prompt Editor | `~/clawd/SOUL.md` | Full file edit with token preview |
| Agent rules | Prompt Editor | `~/clawd/AGENTS.md` | Full file edit with token preview |
| Heartbeat tasks | Prompt Editor | `~/clawd/HEARTBEAT.md` | Full file edit with token preview |
| User profile | Prompt Editor | `~/clawd/USER.md` | Full file edit with token preview |
| Skills | Skills Manager | `~/clawd/skills/*/SKILL.md` | Browse, enable/disable, install |
| Embedding config | RAG Inspector | `config.local.json` | `embedding.chunkSize`, `chunkOverlap` |
| Ollama models | Model Manager | Ollama API | Pull, remove, warm, configure keep-alive |
| Routing rules | Route Switcher | `config.local.json` | Triage buckets + intent detectors |
| Cron jobs | Cron Manager | Clawdbot cron API | Add, edit, delete, test-fire |
| Daemons | Daemons panel | launchd | Status, logs, restart |

---

## Quick Reference

```bash
# Start dashboard
cd ~/Projects/localllm-hub && node cli.js dashboard

# Search memory
node cli.js search "what did we decide about X"

# Check chat indexing
node cli.js chat status

# Reindex memory files
node cli.js reindex --source ~/clawd/memory --db ~/clawd/scripts/memory.db

# Ingest new chat sessions
node cli.js chat ingest

# Classify an email
node cli.js classify --from "noreply@github.com" --subject "PR merged"

# Rate urgency
node cli.js triage "production server is down"
```
