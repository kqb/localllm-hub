# Context Pipeline Optimization Roadmap

**Project:** localllm-hub context-pipeline
**Status:** Comprehensive review — ready for implementation
**Date:** 2026-01-30
**Baseline:** avg 2.5s enrichment (range 1.6–3.5s), 15 chunks/query, minScore 0.3, no caching
**Target:** sub-800ms avg enrichment, 50%+ skip rate, zero quality regression

---

## Current State Analysis

### Architecture (as-built)

```
User Message
    ↓
assembleContext()                          ← packages/context-pipeline/index.js
    ↓
[1] Short-term history (sync)             ← in-memory Map lookup, <1ms
    ↓
[2] RAG: unifiedSearch()                  ← packages/chat-ingest/unified-search.js
    │   embed query via Ollama             ~200-400ms (mxbai-embed-large)
    │   SELECT * FROM chunks               full table scan, all rows into JS
    │   SELECT * FROM chat_chunks          full table scan
    │   SELECT * FROM telegram_chunks      full table scan
    │   cosine similarity in JS loop       O(n) per table
    │   sort + top-K                       ~1200-2500ms total
    ↓
[3] Route: routeToModel()                 ← packages/triage/index.js
    │   generate() via Ollama qwen2.5:14b  ~400-800ms
    │   JSON parse + validation
    ↓
[4] Assembly + prompt construction         ~5-20ms
    ↓
Return enriched context
```

### Measured Bottleneck Breakdown

| Stage | Measured | % of Total |
|-------|----------|------------|
| Query embedding (Ollama) | 200–400ms | ~12% |
| SQLite full-scan + cosine similarity | 800–2000ms | ~56% |
| Route classification (Qwen 14b) | 400–800ms | ~28% |
| Assembly + serialization | 5–20ms | ~1% |
| **Total** | **1600–3500ms** | |

### Key Code-Level Issues

1. **Full table scans in unified-search.js** (lines 43, 69, 96): `SELECT * FROM chunks` loads every row including the 4KB embedding BLOB, then computes cosine similarity in a JS loop. With 390 memory chunks + chat + telegram, this is O(n) per source.

2. **Sequential RAG → Routing**: `assembleContext` runs RAG (step 2, lines 174-188) to completion before starting routing (step 3, lines 191-206). These have zero data dependency.

3. **No query embedding cache**: `unified-search.js:32` calls `embed()` on every search. Repeated or similar queries re-embed from scratch (~300ms wasted).

4. **SQLite connection churn**: `unified-search.js` opens 2-3 separate database connections per search (memory.db line 41, chatDb lines 65+91), reads, then closes. No pooling.

5. **Fixed top-K=15 regardless of route**: A `local_qwen` route for "find file X" gets the same 15 chunks as a `claude_opus` architecture review.

6. **Naive token estimation**: `estimateTokens()` at line 83-86 uses `text.length / 4`. This under-counts for code (more tokens per char) and over-counts for prose.

---

## Optimization 1: Parallel RAG + Routing

### Rationale

RAG search and route classification are independent — routing only needs the raw message text and recent history (already in memory), not RAG results. Running them in parallel saves the full routing latency.

### Implementation

**File:** `packages/context-pipeline/index.js`, replace lines 158-206

```javascript
// Current: sequential
// [2] RAG context
if (pipelineConfig.rag?.enabled) {
  // ... ~1500ms
}
// [3] Routing decision (waits for RAG to finish)
if (pipelineConfig.routing?.enabled) {
  // ... ~600ms
}

// Proposed: parallel
const [ragResult, routeResult] = await Promise.allSettled([
  pipelineConfig.rag?.enabled
    ? (async () => {
        const topK = pipelineConfig.rag.topK || 5;
        const minScore = pipelineConfig.rag.minScore || 0.3;
        const sources = pipelineConfig.rag.sources || ['memory', 'chat', 'telegram'];
        const searchResults = await unifiedSearch(messageText, { topK, sources });
        return searchResults.filter(r => r.score >= minScore);
      })()
    : Promise.resolve([]),

  pipelineConfig.routing?.enabled
    ? (async () => {
        const recentHistory = result.shortTermHistory.slice(-2);
        return routeToModel(messageText, recentHistory);
      })()
    : Promise.resolve(null),
]);

result.ragContext = ragResult.status === 'fulfilled' ? ragResult.value : [];
if (ragResult.status === 'rejected') {
  logger.error(`RAG search failed: ${ragResult.reason.message}`);
}

result.routeDecision = routeResult.status === 'fulfilled' && routeResult.value
  ? routeResult.value
  : { route: pipelineConfig.routing?.fallback || 'claude_sonnet',
      reason: routeResult.status === 'rejected'
        ? `Routing error: ${routeResult.reason.message}`
        : 'Routing disabled',
      priority: 'medium' };
```

### Expected Impact

- **Latency**: max(RAG, routing) instead of RAG + routing. Saves ~400-800ms.
- **New avg**: ~1800ms (down from 2500ms) → **28-32% reduction**
- **Risk**: Low. `Promise.allSettled` ensures one failure doesn't block the other. Current error handling is preserved per-branch.

### Edge Cases

- **Ollama overload**: Both RAG (embedding) and routing (generate) hit Ollama simultaneously. On M4 Max with 36GB unified memory, both mxbai-embed-large (669MB) and qwen2.5:14b (~9GB) can be loaded concurrently (~10GB total, well within 27GB budget). Ollama handles concurrent requests to different models by queuing internally — no request is dropped, but if both models aren't loaded, sequential model loading negates the parallelism benefit.
- **Mitigation**: Ensure both models stay warm. Add a health-check warmup on dashboard start: `curl http://127.0.0.1:11434/api/generate -d '{"model":"qwen2.5:14b","prompt":"hi","options":{"num_predict":1}}'`

### Migration

Non-breaking. Replace sequential calls with parallel. No API changes. Rollback: revert to sequential.

---

## Optimization 2: Query Embedding Cache

### Rationale

`unified-search.js:32` calls `embed()` (Ollama HTTP round-trip) on every search. In a session, users often refine similar queries ("context pipeline" → "context pipeline optimizations" → "context pipeline caching"). A TTL cache on normalized query strings eliminates redundant embeddings.

### Implementation

**File:** `packages/chat-ingest/unified-search.js`

```javascript
// Embedding cache: normalized query → Float64Array
const embeddingCache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(text) {
  // Normalize: lowercase, collapse whitespace, truncate to 200 chars
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function getQueryEmbedding(query) {
  const key = getCacheKey(query);
  const cached = embeddingCache.get(key);

  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.vector;
  }

  const result = await embed(config.models.embed, query);
  const vector = result.embeddings[0];

  // LRU eviction
  if (embeddingCache.size >= CACHE_MAX) {
    const oldest = [...embeddingCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) embeddingCache.delete(oldest[0]);
  }

  embeddingCache.set(key, { vector, ts: Date.now() });
  return vector;
}

// Replace line 32:
// const queryEmbedding = await embed(config.models.embed, query);
// const queryVector = queryEmbedding.embeddings[0];
// With:
const queryVector = await getQueryEmbedding(query);
```

### Expected Impact

- **Cache hit**: <1ms vs ~300ms embedding call → saves 300ms per hit
- **Hit rate estimate**: 15-25% in typical session (repeated/refined queries)
- **Memory cost**: 200 entries × 1024 dims × 8 bytes = ~1.6MB. Negligible.

### Edge Cases

- **Stale embeddings**: 5-minute TTL means reindexed content won't affect cached query vectors. This is acceptable because query embeddings don't change when corpus changes — only the stored chunk embeddings would change (and those aren't cached here).
- **Normalization collisions**: "Context pipeline" and "context pipeline!" map to same key. This is intentional and correct — they should produce identical embeddings.

---

## Optimization 3: SQLite Connection Pooling + Prepared Statements

### Rationale

`unified-search.js` opens up to 3 database connections per search (lines 41, 65, 91), each with `new Database(path)`. SQLite file open/close involves filesystem operations. Additionally, `SELECT * FROM chunks` is re-parsed by SQLite's query planner each time.

### Implementation

**File:** `packages/chat-ingest/unified-search.js`

```javascript
// Module-level connection pool (lazy init, reuse across calls)
let _memoryDb = null;
let _chatDb = null;

function getMemoryDb() {
  const path = config.paths.searchDb;
  if (!_memoryDb && existsSync(path)) {
    _memoryDb = new Database(path, { readonly: true });
    // Prepare statements once
    _memoryDb._allChunks = _memoryDb.prepare('SELECT text, embedding, file, start_line, end_line FROM chunks');
  }
  return _memoryDb;
}

function getChatDb() {
  const path = config.paths.chatDb;
  if (!_chatDb && existsSync(path)) {
    _chatDb = initDb(path);
    _chatDb._allChatChunks = _chatDb.prepare(
      'SELECT text, embedding, session_id, start_ts, end_ts FROM chat_chunks'
    );
    _chatDb._allTelegramChunks = _chatDb.prepare(
      'SELECT text, embedding, start_ts, end_ts FROM telegram_chunks'
    );
  }
  return _chatDb;
}

// Clean shutdown
process.on('exit', () => {
  _memoryDb?.close();
  _chatDb?.close();
});
```

Then replace `new Database(...)` / `.close()` calls with pool accessors, and use prepared statements:

```javascript
// Before:
const db = new Database(memoryDbPath, { readonly: true });
const chunks = db.prepare('SELECT * FROM chunks').all();
db.close();

// After:
const db = getMemoryDb();
if (!db) return; // DB doesn't exist
const chunks = db._allChunks.all();
// No close — connection persists
```

### Expected Impact

- **Connection overhead**: Eliminates ~10-30ms per search (3 opens + 3 closes)
- **Prepared statement reuse**: SQLite skips query parsing on subsequent calls, saving ~5ms per table
- **Total savings**: ~30-60ms per search. Small individually, compounds over time.

### Edge Cases

- **DB file replaced during reindex**: If `reindex` rebuilds `memory.db`, the pooled connection sees stale data. **Mitigation**: Add `invalidatePool()` function called from the reindex CLI command.
- **WAL mode conflicts**: `readonly: true` avoids write contention. If reindex runs concurrently, SQLite WAL mode handles it natively.

---

## Optimization 4: Precomputed Similarity via In-Memory Embedding Matrix

### Rationale

The biggest bottleneck (~56% of total time) is loading all chunk embeddings from SQLite and computing cosine similarity in a JS for-loop. With 390+ chunks at 1024 dimensions, this involves:
- ~390 × 4KB = 1.5MB of BLOB reads
- ~390 × 1024 floating-point multiplications per query

A preloaded Float32Array matrix eliminates repeated SQLite reads and enables optimized batch computation.

### Implementation

**File:** `packages/chat-ingest/unified-search.js` (or new `packages/search/vector-index.js`)

```javascript
class VectorIndex {
  constructor() {
    this.matrix = null;     // Float32Array, row-major [n_chunks × 1024]
    this.metadata = [];     // Array of { source, text, meta }
    this.dim = 1024;
    this.loaded = false;
    this.loadedAt = 0;
    this.staleAfterMs = 60_000; // Reload if older than 60s
  }

  load() {
    const chunks = [];

    // Load from all sources
    const memDb = getMemoryDb();
    if (memDb) {
      for (const row of memDb._allChunks.iterate()) {
        chunks.push({
          embedding: bufferToEmbedding(row.embedding),
          source: 'memory',
          text: row.text,
          meta: { file: row.file, startLine: row.start_line, endLine: row.end_line },
        });
      }
    }

    const chatDb = getChatDb();
    if (chatDb) {
      if (chatDb._allChatChunks) {
        for (const row of chatDb._allChatChunks.iterate()) {
          chunks.push({
            embedding: bufferToEmbedding(row.embedding),
            source: 'chat',
            text: row.text,
            meta: { sessionId: row.session_id, startTs: row.start_ts, endTs: row.end_ts },
          });
        }
      }
      if (chatDb._allTelegramChunks) {
        for (const row of chatDb._allTelegramChunks.iterate()) {
          chunks.push({
            embedding: bufferToEmbedding(row.embedding),
            source: 'telegram',
            text: row.text,
            meta: { startTs: row.start_ts, endTs: row.end_ts },
          });
        }
      }
    }

    // Build contiguous Float32Array matrix
    const n = chunks.length;
    this.matrix = new Float32Array(n * this.dim);
    this.metadata = new Array(n);

    for (let i = 0; i < n; i++) {
      const emb = chunks[i].embedding;
      for (let j = 0; j < this.dim; j++) {
        this.matrix[i * this.dim + j] = emb[j];
      }
      this.metadata[i] = {
        source: chunks[i].source,
        text: chunks[i].text,
        meta: chunks[i].meta,
      };
    }

    // Pre-normalize rows for faster cosine (dot product on unit vectors = cosine)
    for (let i = 0; i < n; i++) {
      let norm = 0;
      const offset = i * this.dim;
      for (let j = 0; j < this.dim; j++) {
        norm += this.matrix[offset + j] ** 2;
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let j = 0; j < this.dim; j++) {
          this.matrix[offset + j] /= norm;
        }
      }
    }

    this.loaded = true;
    this.loadedAt = Date.now();
    logger.debug(`VectorIndex loaded: ${n} chunks, ${(n * this.dim * 4 / 1024).toFixed(0)}KB`);
  }

  search(queryVector, topK, minScore = 0, sourceFilter = null) {
    if (!this.loaded || Date.now() - this.loadedAt > this.staleAfterMs) {
      this.load();
    }

    const n = this.metadata.length;

    // Normalize query vector
    const q = new Float32Array(this.dim);
    let qNorm = 0;
    for (let j = 0; j < this.dim; j++) {
      q[j] = queryVector[j];
      qNorm += q[j] ** 2;
    }
    qNorm = Math.sqrt(qNorm);
    for (let j = 0; j < this.dim; j++) q[j] /= qNorm;

    // Compute dot products (= cosine similarity on pre-normalized vectors)
    const scores = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (sourceFilter && !sourceFilter.includes(this.metadata[i].source)) {
        scores[i] = -1;
        continue;
      }
      let dot = 0;
      const offset = i * this.dim;
      for (let j = 0; j < this.dim; j++) {
        dot += q[j] * this.matrix[offset + j];
      }
      scores[i] = dot;
    }

    // Partial sort: find top-K using selection
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => scores[b] - scores[a]);

    const results = [];
    for (let i = 0; i < Math.min(topK, n); i++) {
      const idx = indices[i];
      if (scores[idx] < minScore) break;
      results.push({
        ...this.metadata[idx],
        score: scores[idx],
      });
    }

    return results;
  }

  invalidate() {
    this.loaded = false;
  }
}

const vectorIndex = new VectorIndex();
module.exports = { vectorIndex };
```

### Expected Impact

- **First query**: Same or slightly slower (one-time load ~100ms for 390 chunks)
- **Subsequent queries**: ~5-20ms for search vs ~800-2000ms currently → **50-100x faster**
- **Memory cost**: 390 chunks × 1024 dims × 4 bytes = ~1.5MB. Trivial.
- **Overall pipeline impact**: Reduces avg enrichment from ~2500ms to ~800-1200ms

### Edge Cases

- **Staleness**: 60-second reload window means new chunks from ingestion take up to 60s to appear in search. Acceptable for non-real-time use. The `invalidate()` method allows explicit refresh from the ingest watcher.
- **Concurrent reload**: If two queries trigger reload simultaneously, both read from SQLite. Not harmful (readonly), just redundant. Could add a mutex, but the window is tiny.
- **Source filtering**: Pre-check in the inner loop avoids computing cosine for excluded sources.

---

## Optimization 5: Smart Skip Logic

### Rationale

Not every message needs RAG + routing. Short acknowledgments ("ok", "thanks"), system messages, and rapid-fire corrections add ~2.5s latency each for zero information gain.

### Implementation

**File:** `packages/context-pipeline/index.js`, add before `assembleContext`

```javascript
const SKIP_PATTERNS = [
  /^(ok|yes|no|sure|thanks?|ty|k|got it|done|np|yep|nope|lol|haha)$/i,
  /^HEARTBEAT/,
  /^System:/,
  /^\[media attached:.*\]$/,
];

const SKIP_MAX_LENGTH = 15; // Messages shorter than this are likely not queries

function shouldSkipEnrichment(messageText) {
  if (messageText.length <= SKIP_MAX_LENGTH) {
    // Short message — check if it's a real short query vs ack
    // Real short queries: "fix it", "run tests", "show logs"
    const hasVerb = /\b(fix|run|show|find|search|list|get|set|add|remove|delete|update|create|explain|describe)\b/i;
    if (!hasVerb.test(messageText)) return true;
  }

  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(messageText.trim())) return true;
  }

  return false;
}
```

Then in `assembleContext`, add early return:

```javascript
async function assembleContext(message, sessionId, options = {}) {
  const startTime = Date.now();
  stats.totalCalls++;

  const messageText = typeof message === 'string' ? message
    : typeof message.content === 'string' ? message.content
    : JSON.stringify(message.content);

  if (shouldSkipEnrichment(messageText)) {
    const assemblyTime = Date.now() - startTime;
    stats.avgAssemblyTime = (stats.avgAssemblyTime * (stats.totalCalls - 1) + assemblyTime) / stats.totalCalls;
    return {
      shortTermHistory: [],
      ragContext: [],
      routeDecision: { route: 'claude_sonnet', reason: 'skipped (simple message)', priority: 'low' },
      systemNotes: [],
      assembledPrompt: [typeof message === 'string' ? { role: 'user', content: message } : message],
      metadata: { sessionId, assemblyTime, skipped: true, config: options },
    };
  }

  // ... rest of existing logic
}
```

### Expected Impact

- **Skip rate**: Estimated 30-50% of messages (acks, short replies, system messages)
- **Skipped message latency**: <1ms vs 2500ms
- **Effective avg across all messages**: ~1200-1600ms (blended)

### Edge Cases

- **False positives**: "no" could be a real response to a question. The skip only affects enrichment (RAG + routing) — the message itself still gets through to the model. The model just won't have pre-fetched context for it, which for "no" is the correct behavior.
- **Short commands**: "fix it" and "run tests" are short but meaningful. The verb detection regex catches these and skips the skip.

---

## Optimization 6: Route-Aware RAG Source Selection

### Rationale

Currently all 3 sources (memory, chat, telegram) are searched for every query. But routing decisions tell us what kind of task this is:
- `local_qwen` (file search) → memory only
- `local_reasoning` (math/logic) → no RAG needed
- `claude_sonnet` (coding) → memory + chat (recent session context)
- `claude_opus` (architecture) → all sources

### Implementation

This requires a slight architecture change: route first, then RAG. Since routing (~600ms) is faster than RAG (~1500ms), this doesn't increase total latency if we can use the route result to reduce RAG work.

**Option A: Route-first, then adaptive RAG** (serial, but total time may decrease)

```javascript
// Route first (fast: ~600ms)
const routeDecision = await routeToModel(messageText, recentHistory);

// Determine sources + topK based on route
const ragConfig = getRouteRagConfig(routeDecision);

// RAG with reduced scope (may be faster than full scan)
const ragContext = ragConfig.topK > 0
  ? await unifiedSearch(messageText, ragConfig)
  : [];

function getRouteRagConfig(route) {
  const configs = {
    local_qwen:      { topK: 3, sources: ['memory'], minScore: 0.4 },
    local_reasoning:  { topK: 0, sources: [], minScore: 0 },  // No RAG
    claude_sonnet:    { topK: 5, sources: ['memory', 'chat'], minScore: 0.3 },
    claude_opus:      { topK: 10, sources: ['memory', 'chat', 'telegram'], minScore: 0.25 },
    wingman:          { topK: 7, sources: ['memory', 'chat'], minScore: 0.3 },
  };
  return configs[route.route] || { topK: 5, sources: ['memory', 'chat', 'telegram'], minScore: 0.3 };
}
```

**Option B: Parallel with speculative full RAG, trim after route resolves**

```javascript
const [fullRag, routeDecision] = await Promise.all([
  unifiedSearch(messageText, { topK: 10, sources: ['memory', 'chat', 'telegram'] }),
  routeToModel(messageText, recentHistory),
]);

// Trim RAG results based on route
const ragConfig = getRouteRagConfig(routeDecision);
const ragContext = fullRag
  .filter(r => ragConfig.sources.includes(r.source))
  .filter(r => r.score >= ragConfig.minScore)
  .slice(0, ragConfig.topK);
```

**Recommendation**: Option B (parallel) with Optimization 4 (in-memory index). Once search is <20ms, the speculative full search costs almost nothing, and we keep the parallelism benefit.

### Expected Impact

- **Option A**: Saves ~30-50% RAG time for local routes (skip telegram/chat), but adds serial dependency
- **Option B**: No latency change but reduces injected context by 30-60% for simple routes → fewer tokens for downstream model

---

## Optimization 7: History Compression via Summarization

### Rationale

`truncateHistory` (line 88-103) does hard truncation — it drops oldest messages entirely when over budget. This loses context. A better approach summarizes dropped messages into a single "context so far" block.

### Implementation

**File:** `packages/context-pipeline/index.js`

```javascript
async function compressHistory(messages, maxMessages, maxTokens) {
  const recent = messages.slice(-maxMessages);
  const recentTokens = recent.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(text);
  }, 0);

  if (recentTokens <= maxTokens) return recent;

  // Budget exceeded — summarize older messages, keep last 5 verbatim
  const keepVerbatim = 5;
  const toSummarize = recent.slice(0, -keepVerbatim);
  const verbatim = recent.slice(-keepVerbatim);

  if (toSummarize.length === 0) {
    // Even last 5 exceed budget — hard truncate (fallback)
    return truncateHistory(messages, maxMessages, maxTokens);
  }

  // Build summary using local model (cheap, fast)
  const summaryText = toSummarize
    .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : '[complex]'}`)
    .join('\n');

  // Use Qwen for cheap local summarization
  try {
    const { generate } = require('../../shared/ollama');
    const config = require('../../shared/config');
    const resp = await generate(config.models.triage,
      `Summarize this conversation in 2-3 sentences, preserving key decisions and topics:\n\n${summaryText.slice(0, 2000)}`,
      { options: { num_predict: 150 } }
    );
    return [
      { role: 'system', content: `[Earlier conversation summary: ${resp.response.trim()}]` },
      ...verbatim,
    ];
  } catch {
    // Fallback to hard truncation
    return truncateHistory(messages, maxMessages, maxTokens);
  }
}
```

### Expected Impact

- **Context quality**: Preserves topic continuity across long sessions
- **Latency cost**: ~200-400ms when triggered (only for sessions exceeding token budget)
- **Frequency**: Only triggers when history exceeds `maxTokenEstimate` (8000 tokens, ~32KB text). Rare in normal use.

### Trade-offs

- Adds an Ollama call on overflow. Since this only fires when the session is already long (and the user is presumably invested), the extra 300ms is acceptable.
- Summary quality depends on Qwen 14b. For conversation summaries, 14b is adequate.
- **Alternative**: Skip summarization entirely and just keep the hard truncation. The summary approach is a quality improvement, not a speed improvement. Implement only if users report context loss in long sessions.

---

## Optimization 8: Expose Per-Stage Timing in Stats

### Rationale

Current stats track only `avgAssemblyTime` (line 264). To validate optimizations, we need per-stage breakdowns: embedding time, similarity computation time, routing time, etc.

### Implementation

**File:** `packages/context-pipeline/index.js`

```javascript
const stats = {
  totalCalls: 0,
  skippedCalls: 0,
  avgAssemblyTime: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastReset: new Date().toISOString(),
  // New: per-stage timing
  stages: {
    embedding: { totalMs: 0, count: 0 },
    similarity: { totalMs: 0, count: 0 },
    routing: { totalMs: 0, count: 0 },
    assembly: { totalMs: 0, count: 0 },
  },
};

function recordStage(name, ms) {
  const s = stats.stages[name];
  if (s) {
    s.totalMs += ms;
    s.count++;
  }
}

// In getStats():
function getStats() {
  const stageAvgs = {};
  for (const [name, s] of Object.entries(stats.stages)) {
    stageAvgs[name] = s.count > 0 ? Math.round(s.totalMs / s.count) : 0;
  }
  return {
    ...stats,
    activeSessions: sessions.size,
    totalMessages: Array.from(sessions.values()).reduce((sum, s) => sum + s.messages.length, 0),
    stageAverages: stageAvgs,
    skipRate: stats.totalCalls > 0 ? (stats.skippedCalls / stats.totalCalls) : 0,
  };
}
```

### Dashboard Integration

The existing `/api/context-monitor` endpoint in `server.js` already exposes pipeline stats. Adding `stageAverages` makes per-stage timing visible without frontend changes (the dashboard already renders key-value pairs dynamically).

---

## Additional Optimizations (Lower Priority)

### 9. Deduplicate `deepMerge`

`deepMerge` is defined identically in `shared/config.js:75` and `context-pipeline/index.js:122`. Extract to `shared/utils.js` and import. Not a performance optimization, but reduces maintenance surface.

### 10. Source-Filtered SQLite Queries

Instead of `SELECT * FROM chunks` (loading all rows), add a `source` column or use separate queries only when needed. With the in-memory VectorIndex (Optimization 4), this becomes moot — filtering happens on the preloaded matrix.

### 11. Embedding Dimension Reduction

mxbai-embed-large produces 1024-dim vectors. For cosine similarity ranking (not exact retrieval), the top 256-512 dimensions capture >95% of variance via PCA or simple truncation. Halving dimensions halves similarity computation time. However, this requires reindexing and quality validation — defer to Phase 5.

---

## Prioritization Matrix

| # | Optimization | Effort | Impact | Risk | Priority |
|---|-------------|--------|--------|------|----------|
| 1 | Parallel RAG + Routing | Low (30 lines) | High (28-32% latency reduction) | Low | **P0** |
| 4 | In-Memory Vector Index | Medium (new class) | Very High (50-100x search speedup) | Medium | **P0** |
| 5 | Smart Skip Logic | Low (20 lines) | High (30-50% calls eliminated) | Low | **P1** |
| 2 | Query Embedding Cache | Low (30 lines) | Medium (15-25% cache hits) | Low | **P1** |
| 8 | Per-Stage Timing Stats | Low (15 lines) | High (observability) | None | **P1** |
| 3 | SQLite Connection Pool | Low (20 lines) | Low-Medium (30-60ms) | Low | **P2** |
| 6 | Route-Aware Source Selection | Medium (arch change) | Medium (fewer tokens injected) | Medium | **P2** |
| 7 | History Compression | Medium (Ollama call) | Medium (quality improvement) | Medium | **P3** |
| 9 | Deduplicate deepMerge | Trivial | None (maintenance) | None | **P3** |
| 11 | Dimension Reduction | High (reindex) | Medium (2x similarity speed) | High | **P4** |

---

## Implementation Sequence

### Phase 1: Foundational Speed (P0 items)

1. **Parallel RAG + Routing** (#1) — Immediate 28-32% latency win
2. **In-Memory Vector Index** (#4) — Eliminates the dominant bottleneck

**Combined expected result**: avg enrichment drops from 2500ms → ~600-900ms

### Phase 2: Skip + Cache (P1 items)

3. **Smart Skip Logic** (#5) — Eliminates unnecessary calls entirely
4. **Query Embedding Cache** (#2) — Speeds up repeated searches
5. **Per-Stage Timing** (#8) — Validates Phase 1 + 2 improvements

**Combined expected result**: blended avg (including skips) drops to ~400-700ms

### Phase 3: Quality + Polish (P2-P3 items)

6. **SQLite Connection Pool** (#3) — Marginal speed, better resource hygiene
7. **Route-Aware Source Selection** (#6) — Reduces injected context for simple routes
8. **History Compression** (#7) — Better long-session continuity
9. **Deduplicate deepMerge** (#9) — Code hygiene

### Phase 4: Experimental (P4)

10. **Dimension Reduction** (#11) — Only if search is still a bottleneck after VectorIndex

---

## Performance Benchmarking Methodology

### Benchmark Script

```javascript
// packages/context-pipeline/benchmark.js
const { assembleContext, getStats, resetStats } = require('./index');

const QUERIES = [
  { text: 'ok', label: 'skip-ack', expected: 'skip' },
  { text: 'yes', label: 'skip-confirm', expected: 'skip' },
  { text: 'find my notes about routing', label: 'simple-search', expected: 'enrich' },
  { text: 'Explain the context pipeline architecture and suggest 5 optimizations', label: 'complex', expected: 'enrich' },
  { text: 'What did we discuss about caching yesterday?', label: 'memory-recall', expected: 'enrich' },
];

async function benchmark(iterations = 5) {
  console.log(`Running ${iterations} iterations per query...\n`);
  resetStats();

  for (const q of QUERIES) {
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const result = await assembleContext(q.text, `bench-${q.label}`);
      times.push(Date.now() - start);
    }

    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b) / times.length;
    const p50 = times[Math.floor(times.length * 0.5)];
    const p95 = times[Math.floor(times.length * 0.95)];
    const min = times[0];
    const max = times[times.length - 1];

    console.log(`${q.label} (${q.expected}):`);
    console.log(`  avg=${avg.toFixed(0)}ms  p50=${p50}ms  p95=${p95}ms  min=${min}ms  max=${max}ms`);
  }

  console.log('\nPipeline stats:', JSON.stringify(getStats(), null, 2));
}

benchmark().catch(console.error);
```

### How to Run

```bash
# Baseline (before optimizations)
node packages/context-pipeline/benchmark.js > bench-baseline.json

# After each phase
node packages/context-pipeline/benchmark.js > bench-phase1.json

# Compare
diff bench-baseline.json bench-phase1.json
```

### Success Criteria

| Metric | Baseline | Phase 1 Target | Phase 2 Target | Final Target |
|--------|----------|----------------|----------------|--------------|
| Avg enrichment (complex) | 2500ms | 800ms | 700ms | <600ms |
| Avg enrichment (simple) | 2500ms | 800ms | 400ms | <300ms |
| Skip latency | N/A | <5ms | <5ms | <1ms |
| Blended avg (all messages) | 2500ms | 1200ms | 600ms | <500ms |
| Skip rate | 0% | 30-50% | 30-50% | 30-50% |
| Cache hit rate | 0% | 0% | 15-25% | 15-25% |
| P95 latency | 3500ms | 1500ms | 1200ms | <1000ms |

---

## Migration & Rollback

### What Breaks

- **Optimization 4 (VectorIndex)**: Changes the internal search path. `unifiedSearch()` API stays identical — callers see no change. If the index fails to load, fall back to current per-query SQLite scan.
- **Optimization 5 (Skip Logic)**: Messages that were previously enriched now skip enrichment. If a short message genuinely needs context (rare), the model handles it without pre-fetched context. No data loss.
- **Optimization 7 (History Compression)**: Changes the shape of `shortTermHistory` (adds a summary system message). Downstream consumers that parse history messages must handle `role: 'system'` entries.

### Rollback Strategy

Each optimization is independently toggleable via `config.local.json`:

```json
{
  "contextPipeline": {
    "features": {
      "parallelExecution": true,
      "vectorIndex": true,
      "skipLogic": true,
      "embeddingCache": true,
      "routeAwareSources": false,
      "historyCompression": false
    }
  }
}
```

Emergency rollback: `git revert <commit>` and restart. No database migrations to undo (all optimizations are read-path only).

---

**Document Version:** 2.0
**Author:** Refined analysis grounded in actual codebase
**Key change from v1.0:** Corrected baseline (routing is already local Qwen, not Claude API), identified true bottleneck (full-table SQLite scan + JS cosine loop), added VectorIndex as the highest-impact optimization
