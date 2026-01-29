# LocalLLM Hub Architecture

## Goal
Unified Node.js + Python workspace consolidating all local LLM infrastructure.
Replace fragmented implementations across ~/Documents/live-translation-local/, ~/Projects/emailctl/, and ~/clawd/scripts/.

## Hardware
- Apple M4 Max, 36GB unified memory
- Ollama running at http://localhost:11434

## Directory Structure

```
localllm-hub/
├── packages/
│   ├── embeddings/          # Unified embedding service
│   │   ├── index.js         # Node.js API (Ollama wrapper)
│   │   ├── cli.js           # CLI: embed, batch-embed, compare
│   │   └── package.json
│   ├── classifier/          # Content classifier
│   │   ├── index.js         # Node.js classification engine
│   │   ├── rules.js         # Rule-based classifier (from emailctl)
│   │   ├── llm.js           # LLM fallback classifier (Ollama)
│   │   ├── cli.js           # CLI: classify <text>, classify-email <id>
│   │   └── package.json
│   ├── triage/              # Urgency router
│   │   ├── index.js         # Router: local vs API decision
│   │   ├── cli.js           # CLI: triage <text>
│   │   └── package.json
│   ├── transcriber/         # Audio transcription
│   │   ├── index.js         # whisper.cpp wrapper
│   │   ├── cli.js           # CLI: transcribe <file>, batch <dir>
│   │   └── package.json
│   └── search/              # Semantic search
│       ├── index.js         # Unified search across sources
│       ├── indexer.js        # Index builder (SQLite + embeddings)
│       ├── cli.js           # CLI: search <query>, reindex
│       └── package.json
├── shared/
│   ├── ollama.js            # Shared Ollama client
│   ├── config.js            # Shared config (models, paths, thresholds)
│   └── logger.js            # Shared logger
├── package.json             # Workspace root (npm workspaces)
└── README.md
```

## Existing Code to Consolidate

### From emailctl (~/Projects/emailctl/lib/)
- `classifier.js` — Rule-based + Ollama fallback classification
  - Rules for: junk, bills, jobs, finance, shopping, travel, health, newsletters, notifications, subscriptions
  - LLM fallback uses Ollama qwen2.5 for unmatched emails
  - Port rules to `packages/classifier/rules.js`
  - Port LLM fallback to `packages/classifier/llm.js`

### From Exocortex (~/Documents/live-translation-local/src/exocortex/)
- `embedder.py` — sentence-transformers all-MiniLM-L6-v2 (384-dim)
  - REPLACE with Ollama mxbai-embed-large (1024-dim) in Node.js
  - Much better quality, native Ollama API, no Python dependency
- `storage.py` — Qdrant vector storage
- `indexer.py` — Memory indexing pipeline
- `memory.py` — Memory data model

### From Zoid's semantic search (~/clawd/scripts/semantic-search.js)
- SQLite + better-sqlite3 + nomic-embed-text (768-dim)
  - Upgrade embedding model to mxbai-embed-large
  - Port search logic to `packages/search/`
  - Keep SQLite backend (proven, portable)

### From Neocortex (~/Documents/live-translation-local/src/neocortex/)
- `processor.py` — LLM processing with RAG + few-shot
  - Confidence-based escalation (>0.8 = auto, <0.8 = escalate to Zoid)
  - Port to `packages/triage/`
- `escalation.py` — Clawdbot gateway wake integration

## Shared Ollama Client

All packages use a single Ollama client wrapper:
```javascript
// shared/ollama.js
const { Ollama } = require('ollama');
const client = new Ollama({ host: process.env.OLLAMA_URL || 'http://localhost:11434' });

module.exports = {
  generate: (model, prompt, opts) => client.generate({ model, prompt, stream: false, ...opts }),
  embed: (model, input) => client.embed({ model, input }),
  chat: (model, messages, opts) => client.chat({ model, messages, stream: false, ...opts }),
};
```

## Model Configuration

```javascript
// shared/config.js
module.exports = {
  models: {
    triage: 'qwen2.5:7b',           // Fast classification
    code: 'qwen2.5-coder:32b',      // Code tasks
    reasoning: 'deepseek-r1:32b',    // Complex analysis
    embed: 'mxbai-embed-large',      // Embeddings (1024-dim)
    embedFast: 'nomic-embed-text',   // Fast embeddings (768-dim)
  },
  thresholds: {
    confidence: 0.8,                 // Below = escalate
    urgency: 3,                      // Above = alert user
  },
  paths: {
    memoryDir: '~/clawd/memory',
    emailDb: '~/Projects/emailctl/emails.db',
    searchDb: '~/clawd/scripts/memory.db',
  },
};
```

## CLI Design

Each package has a standalone CLI that also works as a library:

```bash
# Embeddings
npx localllm embed "some text"
npx localllm embed --batch file1.txt file2.txt
npx localllm embed --compare "text a" "text b"

# Classifier
npx localllm classify "email subject and body"
npx localllm classify --type email --from "billing@stripe.com" --subject "Invoice ready"

# Triage
npx localllm triage "urgent: server is down"
npx localllm triage --route "summarize this document"

# Transcriber
npx localllm transcribe ~/voice-memo.m4a
npx localllm transcribe --batch ~/VoiceMemos/ --output ~/transcripts/

# Search
npx localllm search "what did I decide about the database"
npx localllm search --reindex
```

## Dependencies
- `ollama` (npm) — Ollama client
- `better-sqlite3` (npm) — SQLite for search index
- `commander` (npm) — CLI framework
- `whisper-node` or child_process whisper-cpp — Transcription
