# LocalLLM Hub → Clawdbot Integration Plan

## Goal

Make localllm-hub the unified local AI backend for Clawdbot (Zoid), replacing fragmented implementations across emailctl, semantic-search.js, and exocortex.

## Phase 1: Semantic Search (Replace ~/clawd/scripts/semantic-search.js)

**Priority:** Highest — used every session for memory recall

**Current:** `~/clawd/scripts/semantic-search.js` using nomic-embed-text (768-dim) + SQLite
**New:** `packages/search/` using mxbai-embed-large (1024-dim) + SQLite

### Steps

1. Update `shared/config.js` paths to point at Clawdbot memory dirs
2. Run `localllm reindex` against `~/clawd/memory/` and `~/clawd/MEMORY.md`
3. Update `~/clawd/scripts/semantic-search.js` to delegate to localllm-hub search package
4. Test: `localllm search "what did Kat decide about credentials"` returns relevant memory hits
5. Swap Clawdbot's `memory_search` fallback to use localllm search CLI
6. Deprecate old `scripts/memory.db` after migration

### Config Change (Clawdbot)

```yaml
# In gateway config or AGENTS.md tooling
semantic_search_cmd: "node ~/Projects/localllm-hub/packages/search/cli.js search"
```

## Phase 2: Email Classification (Replace emailctl classifier)

**Priority:** High — used by email triage

**Current:** `~/Projects/emailctl/lib/classifier.js` (rules + Ollama qwen2.5)
**New:** `packages/classifier/` (same rules ported + cleaner API)

### Steps

1. Verify rule parity: run emailctl test cases against new classifier
2. Update emailctl to import from localllm-hub instead of local lib
3. Wire into Clawdbot heartbeat email checks — classify incoming emails
4. Add Clawdbot skill or HEARTBEAT.md instruction:
   ```
   Classify new emails: node ~/Projects/localllm-hub/cli.js classify --from <sender> --subject <subj> --body <body>
   ```
5. Route based on classification: bills → flag, junk → skip, urgent → notify

## Phase 3: Triage Router (New capability)

**Priority:** Medium — enables smart local vs API routing

**Current:** No triage — everything hits Claude API
**New:** `packages/triage/` routes simple tasks locally

### Steps

1. Define triage rules in Clawdbot:
   - Urgency 1-2 + simple task → local LLM (qwen2.5:7b)
   - Urgency 3+ or complex → Claude API
   - Code tasks → always Claude Code
2. Add pre-response hook in Clawdbot agent config:
   ```bash
   localllm triage "$USER_MESSAGE"
   # Returns: { urgency, route: "local"|"api", model, reason }
   ```
3. For local-routed tasks, use Ollama directly (saves API budget)
4. Log routing decisions to `memory/triage-log.json` for tuning

## Phase 4: Embeddings Service (Unified embedding layer)

**Priority:** Medium — foundation for future features

**Current:** Multiple embedding implementations (nomic, mxbai, sentence-transformers)
**New:** `packages/embeddings/` — single API, model-selectable

### Steps

1. All Clawdbot tools that need embeddings import from localllm-hub
2. Standardize on mxbai-embed-large (1024-dim) for quality
3. Use nomic-embed-text (768-dim) as fast fallback when latency matters
4. Expose as local HTTP service (optional, for non-Node consumers):
   ```bash
   localllm serve --port 8484  # Future: REST API wrapper
   ```

## Phase 5: Transcription (Replace ad-hoc whisper calls)

**Priority:** Low — works fine as-is, just consolidation

**Current:** Direct whisper.cpp calls from various scripts
**New:** `packages/transcriber/` — unified wrapper with batch support

### Steps

1. Point voice memo ingestion pipeline at localllm transcribe
2. Add batch mode for processing backlog: `localllm transcribe-batch ~/VoiceMemos/`
3. Wire into Clawdbot: voice messages → transcribe → process

## Integration Architecture

```
┌─────────────────────────────────────────────┐
│                 Clawdbot (Zoid)              │
│                                             │
│  memory_search ──→ localllm search          │
│  email check   ──→ localllm classify        │
│  pre-response  ──→ localllm triage          │
│  voice msgs    ──→ localllm transcribe      │
│  any embedding ──→ localllm embed           │
│                                             │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │   localllm-hub      │
        │   (npm workspace)   │
        │                     │
        │  shared/ollama.js ──┼──→ Ollama (localhost:11434)
        │  shared/config.js   │      ├─ mxbai-embed-large
        │  shared/logger.js   │      ├─ qwen2.5:7b
        │                     │      ├─ qwen2.5-coder:32b
        │  packages/           │      └─ deepseek-r1:32b
        │   ├─ embeddings/    │
        │   ├─ classifier/    │    SQLite (search index)
        │   ├─ triage/        │    whisper.cpp (transcription)
        │   ├─ search/        │
        │   └─ transcriber/   │
        └─────────────────────┘
```

## Quick Wins (Do First)

1. **`localllm search`** → replace semantic-search.js (biggest daily impact)
2. **`localllm classify`** → wire into email heartbeat checks
3. **`localllm triage`** → add to HEARTBEAT.md for smart routing experiments

## Environment Setup

```bash
# Ensure models are available
ollama pull mxbai-embed-large
ollama pull qwen2.5:7b

# Link CLI globally (optional)
cd ~/Projects/localllm-hub && npm link

# Test
localllm embed "test"
localllm classify --from "test@example.com" --subject "Hello" --body "World"
localllm search "test query"
```

## Success Metrics

- **API cost reduction:** Track triage routing — what % of tasks handled locally
- **Search quality:** Compare mxbai-embed-large vs nomic-embed-text on memory recall
- **Classification accuracy:** Monitor LLM fallback rate (lower = better rules)
- **Latency:** Local inference < 2s for triage, < 5s for embeddings
