# LocalLLM Hub — Architecture

## Purpose

Unified local LLM infrastructure for Apple M4 Max (36GB unified memory).
Single Node.js workspace consolidating all local AI capabilities that were previously fragmented across:

- `~/Projects/emailctl/` — email classification
- `~/clawd/scripts/semantic-search.js` — memory search
- `~/Documents/live-translation-local/src/exocortex/` — embeddings + indexing
- `~/Documents/live-translation-local/src/neocortex/` — LLM processing + escalation

One CLI. One dependency tree. One Ollama client. Five packages.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Consumer Layer                              │
│                                                                      │
│  Clawdbot (Zoid)    emailctl    scripts    direct CLI    Node.js API │
│       │                │           │           │              │       │
└───────┼────────────────┼───────────┼───────────┼──────────────┼──────┘
        │                │           │           │              │
        ▼                ▼           ▼           ▼              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        localllm-hub                                  │
│                                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │
│  │  cli.js     │ │  Root CLI   │ │  Commander   │                    │
│  │  (entry)    │─│  routing    │─│  subcommands │                    │
│  └──────┬──────┘ └─────────────┘ └─────────────┘                    │
│         │                                                            │
│  ┌──────┼──────────────────────────────────────────────────────┐     │
│  │      ▼          packages/ (npm workspaces)                  │     │
│  │                                                             │     │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐            │     │
│  │  │ embeddings │  │ classifier │  │  triage    │            │     │
│  │  │            │  │            │  │            │            │     │
│  │  │ • embed()  │  │ • rules.js │  │ • urgency  │            │     │
│  │  │ • batch()  │  │ • llm.js   │  │   rating   │            │     │
│  │  │ • compare()│  │ • index.js │  │ • route    │            │     │
│  │  │            │  │   (combo)  │  │   decision │            │     │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘            │     │
│  │        │               │               │                    │     │
│  │  ┌────────────┐  ┌────────────┐        │                    │     │
│  │  │  search    │  │transcriber │        │                    │     │
│  │  │            │  │            │        │                    │     │
│  │  │ • indexer  │  │ • whisper  │        │                    │     │
│  │  │   (chunk + │  │   .cpp     │        │                    │     │
│  │  │   embed)   │  │ • batch    │        │                    │     │
│  │  │ • query    │  │   mode     │        │                    │     │
│  │  │ • cosine   │  │            │        │                    │     │
│  │  └─────┬──────┘  └─────┬──────┘        │                    │     │
│  │        │               │               │                    │     │
│  └────────┼───────────────┼───────────────┼────────────────────┘     │
│           │               │               │                          │
│  ┌────────▼───────────────▼───────────────▼────────────────────┐     │
│  │                    shared/                                   │     │
│  │                                                              │     │
│  │  ollama.js ─── Single Ollama client (127.0.0.1:11434)       │     │
│  │  config.js ─── Models, thresholds, paths                    │     │
│  │  logger.js ─── Leveled logging (debug/info/warn/error)      │     │
│  └──────────────────────┬───────────────────────────────────────┘     │
│                         │                                            │
└─────────────────────────┼────────────────────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │    External Services   │
              │                        │
              │  Ollama (127.0.0.1)    │
              │  ├─ mxbai-embed-large  │──→ Embeddings (1024-dim)
              │  ├─ qwen2.5:7b         │──→ Classification + Triage
              │  ├─ qwen2.5-coder:32b  │──→ Code tasks (future)
              │  └─ deepseek-r1:32b    │──→ Complex reasoning (future)
              │                        │
              │  SQLite (better-sqlite3)│──→ Search index
              │  whisper.cpp           │──→ Audio transcription
              └────────────────────────┘
```

---

## Hardware

| Component | Spec |
|-----------|------|
| CPU/GPU | Apple M4 Max |
| Memory | 36GB unified (shared CPU/GPU) |
| Available for models | ~27GB (after OS overhead) |
| Ollama version | 0.13.5 |
| Node.js | v25.4.0 |

### Model Memory Budget

| Model | Size | Use Case | Load Time |
|-------|------|----------|-----------|
| mxbai-embed-large | 669 MB | Embeddings | ~0.4s |
| qwen2.5:7b | 4.7 GB | Classification, triage | ~2s |
| nomic-embed-text | 274 MB | Fast embeddings (fallback) | ~0.2s |
| qwen2.5-coder:32b | 19 GB | Code tasks | ~8s |
| deepseek-r1:32b | ~19 GB | Complex reasoning | ~8s |

**Concurrency constraint:** Only 1-2 models can be loaded simultaneously within 27GB available. Ollama auto-unloads after 5 minutes idle (`OLLAMA_KEEP_ALIVE=5m`). Plan requests to minimize model swapping.

---

## Directory Structure

```
localllm-hub/
├── cli.js                    # Root CLI entry point (Commander.js routing)
├── package.json              # npm workspace root
├── package-lock.json
├── .gitignore
│
├── shared/                   # Shared utilities (not a package)
│   ├── ollama.js             #   Ollama client wrapper
│   ├── config.js             #   Models, thresholds, paths
│   └── logger.js             #   Leveled stderr logger
│
├── packages/                 # npm workspaces
│   ├── embeddings/           #   Vector embedding service
│   │   ├── index.js          #     API: embed(), batchEmbed(), compare()
│   │   ├── cli.js            #     CLI: embed, batch-embed, compare
│   │   └── package.json
│   │
│   ├── classifier/           #   Email/content classifier
│   │   ├── index.js          #     API: classify() — rules first, LLM fallback
│   │   ├── rules.js          #     12 rule categories (ported from emailctl)
│   │   ├── llm.js            #     Ollama qwen2.5:7b fallback
│   │   ├── cli.js            #     CLI: classify --from --subject --body
│   │   └── package.json
│   │
│   ├── triage/               #   Urgency + routing
│   │   ├── index.js          #     API: rateUrgency(), routeTask()
│   │   ├── cli.js            #     CLI: triage <text>, route <text>
│   │   └── package.json
│   │
│   ├── transcriber/          #   Audio transcription
│   │   ├── index.js          #     API: transcribe(), batchTranscribe()
│   │   ├── cli.js            #     CLI: transcribe <file>, transcribe-batch <dir>
│   │   └── package.json
│   │
│   └── search/               #   Semantic search
│       ├── index.js           #     API: search(), cosine similarity
│       ├── indexer.js         #     Chunking + batch embedding + SQLite storage
│       ├── cli.js             #     CLI: search <query>, reindex --source --db
│       └── package.json
│
├── test/                     # Test harness (see TESTING.md)
│
├── ARCHITECTURE.md           # This file
├── INTEGRATION.md            # Clawdbot integration plan
├── TESTING.md                # Testing & rollout plan
└── README.md                 # Quick start
```

---

## Package Details

### embeddings

**Purpose:** Generate and compare vector embeddings via Ollama.

**API:**
```javascript
const { embed, batchEmbed, compare } = require('@localllm/embeddings');

const vector = await embed('hello world');        // Float64Array[1024]
const vectors = await batchEmbed(['a', 'b']);      // Float64Array[1024][]
const similarity = await compare('cat', 'dog');    // 0.0 - 1.0
```

**Model:** `mxbai-embed-large` (1024 dimensions). Fallback: `nomic-embed-text` (768 dimensions).

**CLI:**
```bash
localllm embed "hello world"                    # → JSON array of 1024 floats
localllm compare "cat" "dog"                    # → Similarity: 0.6913
localllm batch-embed "hello" "world" "foo"      # → JSON array of arrays
```

**Design decisions:**
- Returns raw float arrays (not wrapped objects) for composability
- Compare uses cosine similarity computed locally (no Ollama roundtrip for comparison)
- Batch embedding sends all texts in single Ollama request for efficiency

---

### classifier

**Purpose:** Categorize emails using a two-tier strategy: fast rules first, LLM fallback for unknowns.

**Architecture:**
```
Input email
    │
    ▼
┌─────────┐     match      ┌──────────────────┐
│ rules.js │──────────────▶│ Return category   │
│ (O(1))   │               │ confidence: 1.0   │
└─────┬────┘               │ method: "rules"   │
      │ no match           └──────────────────┘
      ▼
┌─────────┐     response   ┌──────────────────┐
│ llm.js  │──────────────▶│ Return category   │
│ (qwen)  │               │ confidence: 0.x   │
└─────────┘               │ method: "llm"     │
                           └──────────────────┘
```

**Rule categories (12):**
`junk` · `bills` · `jobs` · `finance` · `health` · `legal` · `travel` · `shopping` · `subscriptions` · `newsletters` · `notifications` · `personal`

**Rule matching:** Checks `from` domain patterns, `subject` regex, `body` keywords, and `labels`. First match wins (categories ordered by priority — junk first, personal last).

**LLM fallback:** Sends email content to `qwen2.5:7b` with structured JSON prompt. Parses response for category + confidence score.

**Performance:**
- Rule match: < 1ms (synchronous, no I/O)
- LLM fallback: 2-5s (model inference)
- Expected rule hit rate: ~80% of common emails

**Ported from:** `~/Projects/emailctl/lib/classifier.js`. Key change: field names normalized from `from_email`/`body_preview` to `from`/`body` for cleaner API.

---

### triage

**Purpose:** Rate message urgency (1-5) and decide whether to route to local LLM or Claude API.

**API:**
```javascript
const { rateUrgency, routeTask } = require('@localllm/triage');

const { urgency, reasoning } = await rateUrgency('server is down');
// → { urgency: 4, reasoning: "Affects system functionality..." }

const { route, confidence, reasoning } = await routeTask('what time is it in Tokyo');
// → { route: "local", confidence: 0.9, reasoning: "Simple factual query" }
```

**Urgency scale:**
| Level | Meaning | Response time |
|-------|---------|---------------|
| 1 | Not urgent | Can wait days |
| 2 | Low | Within 24 hours |
| 3 | Medium | Handle today |
| 4 | High | Within hours |
| 5 | Critical | Immediate |

**Routing logic:**
- `route: "local"` → handle with Ollama (qwen2.5:7b) — saves API budget
- `route: "api"` → requires Claude API (complex reasoning, multi-step, research)

**Model:** `qwen2.5:7b` — fast enough for real-time triage (< 5s), smart enough for urgency assessment.

**Ported from:** `~/Documents/live-translation-local/src/neocortex/processor.py` confidence-based escalation pattern. Threshold: confidence > 0.8 = auto-handle, < 0.8 = escalate.

---

### search

**Purpose:** Semantic search over markdown files using embeddings + SQLite.

**Architecture:**
```
Indexing:                              Querying:
                                       
markdown files                         search query
    │                                      │
    ▼                                      ▼
┌──────────┐                          ┌──────────┐
│ chunk    │  (500 chars,             │ embed    │
│ text     │   100 overlap)           │ query    │
└────┬─────┘                          └────┬─────┘
     │                                     │
     ▼                                     ▼
┌──────────┐                          ┌──────────┐
│ embed    │  (mxbai-embed-large,     │ cosine   │
│ chunks   │   batches of 10)         │ vs all   │
└────┬─────┘                          │ chunks   │
     │                                └────┬─────┘
     ▼                                     │
┌──────────┐                               ▼
│ SQLite   │◄────────────────────── top-k results
│ store    │                       with file:line refs
└──────────┘
```

**Chunking strategy:**
- Max chunk size: 500 characters
- Overlap: 100 characters (prevents losing context at boundaries)
- Split on markdown headers (preserves document structure)
- Each chunk stores: file path, start line, end line, text, embedding blob

**Embedding storage:** Float32 arrays stored as BLOBs in SQLite. Buffer conversion:
```javascript
// Write: Float64 → Float32 → Buffer (4 bytes per dimension)
// Read: Buffer → Float32 → Float64 array
// 1024 dims × 4 bytes = 4KB per chunk
```

**Cosine similarity:** Computed in JavaScript (no native extensions needed):
```
similarity = dot(a, b) / (norm(a) × norm(b))
```

**Database schema:**
```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_chunks_file ON chunks(file);
```

**Performance (390 chunks from ~/clawd/memory/):**
- Full reindex: ~60s (embedding generation dominates)
- Single query: < 500ms (cosine similarity over 390 chunks)
- Database size: ~2MB

**Ported from:** `~/clawd/scripts/semantic-search.js`. Upgrades: nomic-embed-text (768-dim) → mxbai-embed-large (1024-dim), added chunking with overlap, batch embedding.

---

### transcriber

**Purpose:** Transcribe audio files using whisper.cpp.

**Security:** Uses `execFile` (not `exec`) to prevent shell injection. Arguments passed as array, never interpolated into a shell string.

**Supported formats:** `.m4a` `.wav` `.mp3` `.mp4` `.ogg` `.flac`

**Binary discovery:** Searches `/usr/local/bin/whisper-cpp`, `/opt/homebrew/bin/whisper-cpp`, and `WHISPER_CPP_PATH` env var.

**Batch mode:** Processes all supported audio files in a directory sequentially. Returns array of results with per-file error handling (one failure doesn't stop the batch).

---

## Shared Layer

### ollama.js

Single Ollama client instance shared by all packages.

```javascript
const client = new Ollama({
  host: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
});
```

**Key detail:** Uses `127.0.0.1` not `localhost`. On macOS, `localhost` resolves to `::1` (IPv6) first, which Ollama doesn't bind to. This caused `HeadersTimeoutError` in Node.js's undici HTTP client. The `127.0.0.1` fix ensures direct IPv4 connection.

**Exports:** `generate()`, `embed()`, `chat()` — all with `stream: false` (returns complete response, not streaming).

### config.js

Centralized configuration for all packages:

- **Models:** Which Ollama model each task uses
- **Thresholds:** Confidence cutoff (0.8) and urgency alert level (3)
- **Paths:** Memory directory, email database, search database
- **Embedding config:** Dimension (1024), chunk size (500), overlap (100)

### logger.js

Leveled logging to stderr (keeps stdout clean for CLI JSON output):

- `LOG_LEVEL=debug` — verbose (development)
- `LOG_LEVEL=info` — normal (default)
- `LOG_LEVEL=warn` — warnings only
- `LOG_LEVEL=error` — errors only

---

## CLI Routing

Root `cli.js` uses Commander.js with lazy imports:

```javascript
program.command('embed').action(() => {
  // Only loads embeddings package when 'embed' command is used
  const { embed } = require('./packages/embeddings');
});
```

**Why lazy:** Startup stays fast (~50ms) regardless of how many packages exist. Ollama connection only established when a command actually needs it.

**Full command list:**
| Command | Package | Ollama Required |
|---------|---------|-----------------|
| `embed <text>` | embeddings | ✅ |
| `batch-embed <texts...>` | embeddings | ✅ |
| `compare <a> <b>` | embeddings | ✅ |
| `classify` | classifier | Only for LLM fallback |
| `triage <text>` | triage | ✅ |
| `route <text>` | triage | ✅ |
| `search <query>` | search | ✅ |
| `reindex` | search | ✅ |
| `transcribe <file>` | transcriber | ❌ (uses whisper.cpp) |
| `transcribe-batch <dir>` | transcriber | ❌ (uses whisper.cpp) |

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `ollama` | ^0.5.0 | Ollama API client |
| `better-sqlite3` | ^11.0.0 | SQLite for search index (native, fast) |
| `commander` | ^12.0.0 | CLI framework |

**Total:** 46 packages installed, 0 vulnerabilities.

**No Python dependencies.** Everything runs in Node.js. Previous implementations used Python (sentence-transformers, Qdrant) — all replaced with Ollama API + SQLite.

---

## Known Issues & Mitigations

### Ollama Freeze Under Load

**Issue:** Concurrent model pulls + inference requests can freeze Ollama (accepts TCP connections but returns no HTTP response).

**Mitigation:** 
- Sequential model operations (don't pull and infer simultaneously)
- Health check before inference: `curl -s --max-time 3 http://127.0.0.1:11434/`
- Auto-restart script if frozen (see INTEGRATION.md)

### First Model Load Latency

**Issue:** First inference after model unload takes 2-8s (loading weights into GPU memory). Default Ollama fetch timeout in Node.js undici is too short.

**Mitigation:**
- Warm models before batch operations: `ollama run mxbai-embed-large "warmup"`
- Consider `OLLAMA_KEEP_ALIVE=30m` for frequently used models
- Graceful timeout handling in all packages (catch + retry or degrade)

### IPv6 Resolution on macOS

**Issue:** `localhost` resolves to `::1` (IPv6) on macOS. Ollama binds to `127.0.0.1` (IPv4). Node.js undici tries IPv6 first, times out.

**Fix:** `shared/ollama.js` uses `127.0.0.1` explicitly. All config uses `127.0.0.1`.

---

## Future Considerations

- **HTTP API server:** Expose localllm-hub as REST API for non-Node consumers
- **Model preloading service:** Keep frequently-used models warm via cron
- **Embedding cache:** Cache embeddings for unchanged files (skip re-embedding on reindex)
- **Streaming:** Add stream mode for long-running generate/chat operations
- **Metrics endpoint:** Expose latency/throughput stats for monitoring dashboard
