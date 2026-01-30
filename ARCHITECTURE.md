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

## Multi-Model Routing Architecture ("All-Star" Team)

LocalLLM Hub routes prompts to the cheapest capable model via a 5-tier architecture. Each tier has a distinct role and the local Qwen router classifies every incoming prompt before dispatch.

### The Master Routing Table

| Tier | Model | Role | Best Use Case | Router Keywords |
|------|-------|------|---------------|-----------------|
| S1 | Gemini 3 Pro | The Visionary | Deep reasoning, 1M+ context, strategic planning, research | `PLAN`, `RESEARCH`, `DEEP_THINK`, `HUGE_CONTEXT` |
| S2 | Claude 4.5 Opus | The Auditor | Critical execution, security audits, final production code | `AUDIT`, `CRITICAL`, `FINAL_DRAFT`, `SECURITY` |
| A | Claude Sonnet | The Engineer | Coding loop: features, bugs, tests. 80% of daily workload | `CODE`, `DEV`, `FEATURE`, `DEBUG` |
| B | Claude Haiku | The Analyst | Triage, summarization, data extraction, fast Q&A | `SUMMARIZE`, `EXTRACT`, `FAST`, `EMAIL` |
| C | Qwen 2.5 14B (Local) | The Intern | Note search, file discovery, classification, routing | `SEARCH`, `FIND`, `LOCAL`, `PRIVATE` |

### Two-Phase Planning Workflow

Complex planning tasks use a Gemini → Opus handoff:

```
User: "Refactor the entire auth system to use OAuth2"
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  Phase 1: Strategic Planning (Gemini 3 Pro)         │
│                                                     │
│  Input: All auth files + docs (via 1M context)      │
│  Output: High-level strategy with pros/cons         │
│  Access: CDP browser automation (gemini-chat.mjs)   │
└──────────────────┬──────────────────────────────────┘
                   │ Strategy document
                   ▼
┌─────────────────────────────────────────────────────┐
│  Phase 2: Execution Planning (Claude Opus)          │
│                                                     │
│  Input: Gemini's strategy + target files            │
│  Output: Strict TODO.md with file paths + sigs      │
│  Access: Claude Max session (OAuth)                 │
└──────────────────┬──────────────────────────────────┘
                   │ Implementation plan
                   ▼
┌─────────────────────────────────────────────────────┐
│  Phase 3: Execution (Claude Sonnet)                 │
│                                                     │
│  Input: TODO.md checklist                           │
│  Output: Working code                               │
│  Access: Claude Max session (OAuth)                 │
└─────────────────────────────────────────────────────┘
```

**Planning sub-router:**

| Planning Phase | Model | Triggers |
|----------------|-------|----------|
| Strategic (explorative) | Gemini 3 Pro | "How should we...", "Propose a strategy...", "Roadmap" |
| Execution (definitive) | Claude Opus | "Create impl plan", "Define interface", "Write tech spec" |

### Fallback Strategy (Cross-Provider Resilience)

```
Haiku fails    → escalate to Sonnet
Sonnet fails   → switch to Gemini 3 Pro
Opus fails     → switch to Gemini 3 Pro
Gemini fails   → switch to Opus (⚠️ context limit warning)
```

### Provider Access Patterns

**CRITICAL:** This project does NOT use API keys for Gemini or Anthropic. All access is through authenticated sessions.

| Provider | Access Method | Details |
|----------|--------------|---------|
| **Gemini 3 Pro** | CDP browser automation | Puppeteer connects to Chrome on `127.0.0.1:9222` with persistent Google-authenticated profile (`~/chrome-cdp-profile`). Uses `~/clawd/skills/gemini-chat/gemini-chat.mjs`. No API key. |
| **Claude (Opus/Sonnet/Haiku)** | Claude Max subscription (OAuth) | OAuth tokens in `~/.clawdbot/agents/main/agent/auth-profiles.json`. Clawdbot manages token refresh. Profile: `anthropic:claude-cli`. No `ANTHROPIC_API_KEY`. |
| **Qwen / Embeddings** | Ollama local | Direct HTTP to `http://127.0.0.1:11434`. Always available, zero cost. |

#### Gemini CDP Access (No API Key)

Chrome must be running with CDP enabled:

```bash
# Start CDP Chrome with authenticated Google profile
~/scripts/start-chrome-cdp.sh https://gemini.google.com

# Verify CDP is live
curl -s http://127.0.0.1:9222/json/version

# Send message programmatically
node ~/clawd/skills/gemini-chat/gemini-chat.mjs "Your prompt here"
node ~/clawd/skills/gemini-chat/gemini-chat.mjs --new "Start fresh"
node ~/clawd/skills/gemini-chat/gemini-chat.mjs --read
```

**Key constraints:**
- Requires Gemini Advanced subscription (signed in via Chrome profile)
- Send button state must be checked before sending (idle vs generating)
- Text is set via JavaScript injection (`contenteditable` element), not keystrokes
- 90s timeout for response generation
- Pro model limit can be hit; `checkProLimit()` detects this
- **Deterministic path:** CDP + DOM selectors = no LLM cost to operate Gemini

#### Claude Max Access (OAuth, Not API Keys)

Clawdbot uses OAuth tokens from Claude Max subscription:

```json
// ~/.clawdbot/agents/main/agent/auth-profiles.json
{
  "profiles": {
    "anthropic:claude-cli": {
      "type": "oauth",
      "provider": "anthropic",
      "access": "sk-ant-oat01-...",
      "refresh": "sk-ant-ort01-...",
      "expires": <epoch_ms>
    }
  }
}
```

**Key constraints:**
- Token refresh handled by Clawdbot runtime
- No per-token billing — flat subscription cost
- Usage tracked via `usageStats` in auth-profiles
- Claude Code Wingman spawns tmux sessions using same OAuth profile
- All Anthropic models (Opus/Sonnet/Haiku) available through the subscription

### Pre-Processing Compression Layer

Before sending to Claude Opus for planning, use Haiku to compress source files into architectural briefs. This lets Opus "see" 50+ files without blowing its 200k context limit.

```
500-line TypeScript file (~2,000 tokens)
        │
        ▼ Haiku distills
Architectural summary (~200 tokens)
        │
        ▼ 90% token savings
Opus reads summaries, not source
```

**Distiller prompt:** Forces Haiku to extract only exported interfaces, types, function signatures, imports, and a 1-sentence summary. Omits all function bodies.

**Adaptation for our setup:** The original `pre_process_planning.js` from the Gemini discussion uses `@anthropic-ai/sdk` with an API key. For our Claude Max setup, this must route through Clawdbot's gateway (port 18789) or use the Ollama OpenAI-compatible endpoint at `http://127.0.0.1:11434/v1` with a local model for the compression step (zero cost).

### Haiku Optimization: XML-Structured System Prompts

Claude 3.5 Haiku's instruction adherence improves significantly with XML-tagged prompts:

```xml
<system_instruction>
  <role>...</role>
  <constraints>
    <constraint>Output ONLY JSON, no conversational filler</constraint>
  </constraints>
  <output_schema>{ ... }</output_schema>
  <formatting_rules>
    <rule>Escape all double quotes within content</rule>
    <rule>No markdown code blocks around JSON output</rule>
  </formatting_rules>
</system_instruction>
```

### Router System Prompt (Qwen 2.5 14B)

The local router classifies every incoming prompt:

```
ROLE: System Router. Classify the User Request.

DECISION TREE:

1. REQUIRES "DEEP THINKING" OR >200K CONTEXT?
   - Triggers: "Plan", "Research", "Analyze entire repo", "Think deeply"
   - Route: GEMINI_3_PRO
   - Reason: Only Gemini handles >200k context and has "Thinking" mode.

2. CRITICAL PRODUCTION / SECURITY TASK?
   - Triggers: "Audit", "Finalize", "Refactor Security", "Production Ready"
   - Route: CLAUDE_OPUS
   - Reason: Highest safety and instruction adherence.

3. STANDARD CODING / DEV LOOP?
   - Triggers: "Write function", "Fix bug", "Add feature", "Create script"
   - Route: CLAUDE_SONNET
   - Reason: Best speed/quality balance for iterative coding.

4. FAST PROCESSING / DATA / TRIAGE?
   - Triggers: "Summarize", "Extract", "Rewrite", "Email", "Simple Q&A"
   - Route: CLAUDE_HAIKU
   - Reason: Fastest model for simple tasks.

5. LOCAL SEARCH / PRIVATE?
   - Triggers: "Search notes", "Find file", "List directory", "Private data"
   - Route: LOCAL_QWEN
   - Reason: Zero latency, local privacy.

OUTPUT FORMAT:
{"route": "...", "reason": "...", "priority": "high|medium|low"}
```

---

## Updated Model Memory Budget

Target configuration downsizes 32B models to 14B for concurrent loading:

| Model | Size | Role | Status |
|-------|------|------|--------|
| mxbai-embed-large | 669MB | Embeddings (1024-dim) | Always loaded |
| qwen2.5:7b | 4.7GB | Router + Triage | Always loaded |
| qwen2.5-coder:14b | ~9GB | Code tasks | On-demand |
| deepseek-r1:14b | ~9GB | Complex reasoning | On-demand |

**Total always-on:** ~5.4GB (embeddings + router), leaving ~22GB headroom for on-demand models and OS.

**Freed capacity enables:**
- Vector DB cache in RAM (0.1s queries vs 5s disk reads)
- Chat ingest watcher daemon (background JSONL parsing)
- Router model always warm (instant triage, no cold-start)

---

## Future Considerations

- **HTTP API server:** Expose localllm-hub as REST API for non-Node consumers
- **Model preloading service:** Keep frequently-used models warm via cron
- **Embedding cache:** Cache embeddings for unchanged files (skip re-embedding on reindex)
- **Streaming:** Add stream mode for long-running generate/chat operations
- **Metrics endpoint:** Expose latency/throughput stats for monitoring dashboard
- **Activate route switching:** Wire triage into Clawdbot prompt pipeline via Qwen router
- **Librarian pre-fetch:** Local semantic search before Claude to reduce roundtrips
- **Token economics dashboard:** Track cost savings from local routing per session
