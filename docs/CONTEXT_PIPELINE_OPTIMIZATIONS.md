# Context Pipeline Optimization Implementation Plan

**Project:** localllm-hub context-pipeline  
**Status:** Ready for Implementation  
**Philosophy:** **Quality First, Then Speed** ⭐  
**Estimated Impact:** 60-75% latency reduction (4120ms → 1000-1500ms avg) + 15-20% routing accuracy improvement  
**Priority:** High (user-facing latency + quality improvement)

---

## ⚠️ Priority Shift: Quality Before Speed

**Original Plan:** Local router in Phase 1 (speed-first)  
**Updated Plan:** Routing quality improvements in Phase 2, local router in Phase 4 (quality-first)

**Why:** A mis-routed query results in poor responses regardless of speed. Better to route correctly at 500ms than incorrectly at 50ms.

**New Sequence:**
1. **Phase 1:** Quality-neutral speed wins (parallel execution, skip logic)
2. **Phase 2:** Routing quality (enhanced prompts, validation, confidence scoring) ← **PRIORITY**
3. **Phase 3:** Caching + two-stage RAG (quality-preserving optimizations)
4. **Phase 4:** Local router (ONLY after quality validated with A/B testing)
5. **Phase 5:** Polish (database, embedding models)

**Key Change:** Claude API router stays in place (with quality improvements) until local router proves it can match or beat Claude's routing accuracy.

---

## Current State Analysis

### Performance Baseline (from dashboard 2026-01-30)
- **Average enrichment time:** 4120ms
- **Route distribution:** 57% local_qwen, 43% claude_haiku
- **Total calls:** 7
- **Bottlenecks identified:**
  1. Sequential execution (RAG → Route → Assemble)
  2. Router making API calls (should be local)
  3. Every message enriched (no skip logic)
  4. Fixed top-K=15 regardless of query complexity

### Architecture Overview
```
User Message
    ↓
assembleContext()
    ↓
[1. Semantic Search (RAG)]  ← ~2000-3000ms
    ↓
[2. Route Decision]          ← ~500-800ms (API call!)
    ↓
[3. Context Assembly]        ← ~200-400ms
    ↓
Return enrichment
```

---

## Philosophy: Quality First, Then Speed

**Priority Order:**
1. Routing quality (bad route = bad response, no matter how fast)
2. Quality-neutral speed wins (parallel execution, skip logic)
3. Quality-preserving optimizations (caching, adaptive top-K)
4. Speed optimizations requiring validation (local router)

---

## Phase 1: Quality-Neutral Speed Wins

### 1.1 Parallel Execution Architecture

**File:** `packages/context-pipeline/index.js`

**Current Code:**
```javascript
async function assembleContext(message, sessionId, options = {}) {
  const startTime = Date.now();
  
  // 1. RAG search (blocks routing)
  const ragContext = await semanticSearch(message, {
    topK: 15,
    sources: ['memory', 'chat', 'telegram']
  });
  
  // 2. Routing decision (waits for RAG)
  const routeDecision = await routeToModel(message, shortTermHistory);
  
  // 3. Assembly
  return { ragContext, routeDecision, ... };
}
```

**Optimized Code:**
```javascript
async function assembleContext(message, sessionId, options = {}) {
  const startTime = Date.now();
  
  // PARALLEL: Router doesn't need RAG results
  const [ragContext, routeDecision, shortTermHistory] = await Promise.all([
    semanticSearch(message, {
      topK: 15,
      sources: ['memory', 'chat', 'telegram']
    }),
    // Router can work with just the message + recent history
    (async () => {
      const history = await getShortTermHistory(sessionId, 3);
      return routeToModel(message, history);
    })(),
    getShortTermHistory(sessionId, 3) // Reuse for assembly
  ]);
  
  return { ragContext, routeDecision, ... };
}
```

**Expected Impact:** ~30-40% latency reduction (2800-3000ms)

**Test Cases:**
```javascript
// Test: Parallel execution timing
describe('Parallel Execution', () => {
  it('should execute RAG and routing in parallel', async () => {
    const start = Date.now();
    const result = await assembleContext('test query', 'test-session');
    const duration = Date.now() - start;
    
    // Should be ~max(ragTime, routeTime), not sum
    expect(duration).toBeLessThan(3500); // Was 4000+
  });
});
```

---

### 1.2 Smart Skip Logic

**File:** `packages/context-pipeline/index.js`

**Add Skip Detection:**
```javascript
function shouldEnrich(message, sessionId) {
  // Skip very short messages
  if (message.length < 20) return false;
  
  // Skip heartbeat acknowledgments
  if (message === 'HEARTBEAT_OK') return false;
  
  // Skip simple acknowledgments
  const simpleAcks = ['ok', 'thanks', 'got it', 'yes', 'no', 'done', 'k', 'ty'];
  if (simpleAcks.includes(message.toLowerCase().trim())) return false;
  
  // Skip system messages
  if (message.startsWith('System:')) return false;
  
  // Skip if message is just a media attachment
  if (message.match(/^\[media attached:.*\]$/)) return false;
  
  // Skip rapid-fire messages from same user (likely typing corrections)
  const lastMessage = getLastMessage(sessionId);
  if (lastMessage && Date.now() - lastMessage.timestamp < 5000) {
    return false; // Skip if <5s since last message
  }
  
  return true;
}

// Update assembleContext entry point
async function assembleContext(message, sessionId, options = {}) {
  // Fast path: skip enrichment for simple messages
  if (!shouldEnrich(message, sessionId)) {
    return {
      ragContext: [],
      routeDecision: {
        route: 'claude_haiku', // Default to fast model
        reason: 'simple message (skipped enrichment)',
        priority: 'low'
      },
      systemNotes: [],
      metadata: { assemblyTime: 0, skipped: true }
    };
  }
  
  // Full enrichment for complex messages
  const startTime = Date.now();
  // ... rest of existing code
}
```

**Expected Impact:** ~60% of messages skip enrichment (instant response)

**Test Cases:**
```javascript
describe('Skip Logic', () => {
  it('should skip short messages', () => {
    expect(shouldEnrich('ok', 'session-1')).toBe(false);
    expect(shouldEnrich('thanks', 'session-1')).toBe(false);
  });
  
  it('should skip heartbeats', () => {
    expect(shouldEnrich('HEARTBEAT_OK', 'session-1')).toBe(false);
  });
  
  it('should skip system messages', () => {
    expect(shouldEnrich('System: Context regenerated', 'session-1')).toBe(false);
  });
  
  it('should enrich real queries', () => {
    expect(shouldEnrich('What are the optimizations we discussed?', 'session-1')).toBe(true);
  });
});
```

---

## Phase 2: Routing Quality Improvements (PRIORITY)

**Goal:** Improve routing accuracy before optimizing for speed.

### 2.1 Enhanced Router Prompt

**File:** `packages/triage/router-prompt.js`

**Current Issue:** Generic routing prompt without examples leads to inconsistent decisions.

**Improved Prompt with Few-Shot Examples:**
```javascript
function buildEnhancedRouterPrompt(query, history) {
  return `You are an expert model router for an AI assistant. Analyze the query and select the optimal model.

## Routes:
- **claude_opus** → Complex architecture, security audits, multi-file refactors, production debugging
- **claude_sonnet** → Feature work, bug fixes, code reviews, standard tasks (default)
- **claude_haiku** → Triage, summaries, simple Q&A, quick lookups
- **local_qwen** → File search, note retrieval, classification, local operations
- **local_reasoning** → Math, logic puzzles, step-by-step reasoning

## Example Routing Decisions:

Query: "Refactor the authentication module to use JWT tokens"
Route: claude_sonnet
Reason: Standard feature work requiring code changes
Priority: medium

Query: "Design a distributed caching architecture for 1M QPS"
Route: claude_opus  
Reason: Complex architecture requiring deep reasoning
Priority: high

Query: "What did we discuss about optimizations yesterday?"
Route: local_qwen
Reason: Memory search, local operation
Priority: low

Query: "Summarize this 50-line error log"
Route: claude_haiku
Reason: Simple triage and summarization
Priority: low

Query: "Solve this differential equation step-by-step"
Route: local_reasoning
Reason: Mathematical reasoning task
Priority: medium

## Current Query:
${query}

## Recent Context:
${history.slice(-3).map(m => `${m.role}: ${m.content.slice(0, 150)}...`).join('\n')}

## Your Decision:
Analyze the query complexity, required capabilities, and context. Output:

route: [claude_opus|claude_sonnet|claude_haiku|local_qwen|local_reasoning]
reason: [specific one-line explanation]
priority: [low|medium|high]
confidence: [low|medium|high]

Output:`;
}
```

**Expected Impact:** 15-20% improvement in routing accuracy

---

### 2.2 Route Validation & Fallback

**File:** `packages/triage/validator.js` (new)

**Add confidence scoring and validation:**
```javascript
function validateRoute(route, query, confidence) {
  // Validate route makes sense for query
  const validators = {
    local_qwen: (q) => {
      // Should only route here for file/memory operations
      const keywords = ['find', 'search', 'note', 'remember', 'memory', 'file', 'document'];
      return keywords.some(kw => q.toLowerCase().includes(kw));
    },
    
    claude_opus: (q) => {
      // Should only route to Opus for genuinely complex tasks
      const complexityIndicators = [
        'architect', 'design', 'security', 'audit', 'refactor',
        'production', 'distributed', 'scale', 'optimize'
      ];
      return complexityIndicators.some(ind => q.toLowerCase().includes(ind));
    },
    
    claude_haiku: (q) => {
      // Should be simple tasks
      return q.length < 100 || ['what', 'how', 'summarize', 'list'].some(w => q.toLowerCase().startsWith(w));
    }
  };
  
  const validator = validators[route];
  if (!validator) return true; // No validator, trust the route
  
  const isValid = validator(query);
  
  // If low confidence OR validation failed, fallback to Sonnet (safe default)
  if (confidence === 'low' || !isValid) {
    console.warn(`[router] Route ${route} failed validation or low confidence, falling back to sonnet`);
    return {
      route: 'claude_sonnet',
      reason: `Fallback from ${route} (validation failed or low confidence)`,
      priority: 'medium',
      originalRoute: route
    };
  }
  
  return true; // Route is valid
}

// Usage in routeToModel
async function routeToModel(query, conversationHistory = []) {
  const response = await callRouterAPI(query, conversationHistory);
  
  // Parse response
  const decision = parseRouterResponse(response);
  
  // Validate
  const validated = validateRoute(decision.route, query, decision.confidence);
  
  if (validated !== true) {
    // Validation failed, use fallback route
    return validated;
  }
  
  return decision;
}
```

**Expected Impact:** Reduce mis-routed queries by 30-40%

---

### 2.3 Route Decision Logging & Analysis

**File:** `packages/triage/analytics.js` (new)

**Track routing decisions for continuous improvement:**
```javascript
const Database = require('better-sqlite3');
const config = require('../../shared/config');

function logRouteDecision(query, decision, actualModel, feedback = null) {
  const db = new Database(config.paths.chatDb);
  
  db.prepare(`
    INSERT INTO route_decisions (
      timestamp, query, route, reason, priority, confidence,
      actual_model, user_feedback, query_length
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(),
    query.slice(0, 500),
    decision.route,
    decision.reason,
    decision.priority,
    decision.confidence || 'medium',
    actualModel,
    feedback,
    query.length
  );
  
  db.close();
}

// Analytics queries
function getRoutingAccuracy(days = 7) {
  const db = new Database(config.paths.chatDb, { readonly: true });
  
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const stats = db.prepare(`
    SELECT 
      route,
      COUNT(*) as count,
      AVG(CASE WHEN route = actual_model THEN 1 ELSE 0 END) as accuracy,
      AVG(query_length) as avg_query_length
    FROM route_decisions
    WHERE timestamp > ?
    GROUP BY route
  `).all(since);
  
  db.close();
  return stats;
}
```

**Database Migration:**
```sql
CREATE TABLE IF NOT EXISTS route_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  query TEXT NOT NULL,
  route TEXT NOT NULL,
  reason TEXT,
  priority TEXT,
  confidence TEXT,
  actual_model TEXT,
  user_feedback TEXT,
  query_length INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_route_timestamp ON route_decisions(timestamp);
CREATE INDEX idx_route_route ON route_decisions(route);
```

**Expected Impact:** Data-driven router improvements over time

---

### 2.4 Multi-Shot Classification (Advanced)

**For extremely high accuracy, use chain-of-thought routing:**

```javascript
async function routeWithCoT(query, history) {
  const cotPrompt = `Analyze this query step-by-step:

Query: "${query}"

Step 1: What is the user asking for?
Step 2: What capabilities are required?
Step 3: What is the complexity level?
Step 4: Which model is best suited?

Think through each step, then provide your final routing decision.`;

  const response = await callRouterAPI(cotPrompt, history);
  
  // Parse chain-of-thought response
  const lines = response.split('\n');
  const finalDecision = lines[lines.length - 1]; // Last line should be the route
  
  return parseFinalDecision(finalDecision);
}
```

**Expected Impact:** 95%+ routing accuracy (at cost of 200-300ms extra latency)

**When to use:** Critical decisions, first message in session, user explicitly requests specific quality

---

## Phase 3: Two-Stage RAG + Caching

### 3.1 Two-Stage RAG Retrieval

**File:** `packages/search/unified-search.js`

**Current Approach:**
- Retrieve 15 results
- Full cosine similarity for all chunks
- Return top 15

**Optimized Approach:**
- Stage 1: Fast pre-filter (top 50 with approximate scoring)
- Stage 2: Rerank top 15 with full similarity

**Implementation:**
```javascript
async function unifiedSearch(query, options = {}) {
  const topK = options.topK || 5;
  const sources = options.sources || ['memory', 'chat', 'telegram'];
  
  // Stage 1: Fast pre-filter (retrieve 3-5x target)
  const candidateK = topK * 3;
  const candidates = await fastPreFilter(query, candidateK, sources);
  
  // Stage 2: Rerank with full similarity
  const reranked = await rerankResults(query, candidates, topK);
  
  return reranked;
}

async function fastPreFilter(query, k, sources) {
  // Use simpler similarity metric or BM25 for speed
  // For now: just retrieve more with existing method
  return await retrieveChunks(query, k, sources);
}

async function rerankResults(query, candidates, topK) {
  // Full cosine similarity for final ranking
  const queryEmb = await getEmbedding(query);
  
  const scored = candidates.map(chunk => ({
    ...chunk,
    fullScore: cosineSimilarity(queryEmb, chunk.embedding)
  }));
  
  scored.sort((a, b) => b.fullScore - a.fullScore);
  
  return scored.slice(0, topK);
}
```

**Expected Impact:** 2-3x faster search (especially for large databases)

---

### 3.2 Result Caching

**File:** `packages/context-pipeline/cache.js` (new)

**Implementation:**
```javascript
const LRU = require('lru-cache');

const cache = new LRU({
  max: 100, // Store 100 recent queries
  ttl: 60 * 1000, // 60 second TTL
  updateAgeOnGet: false
});

function getCacheKey(message, sessionId) {
  // Normalize query for cache hits
  const normalized = message.toLowerCase().trim().slice(0, 200);
  return `${sessionId}:${normalized}`;
}

async function getCachedOrEnrich(message, sessionId, enrichFn) {
  const key = getCacheKey(message, sessionId);
  
  const cached = cache.get(key);
  if (cached) {
    return {
      ...cached,
      metadata: { ...cached.metadata, cacheHit: true }
    };
  }
  
  const result = await enrichFn();
  cache.set(key, result);
  
  return result;
}

// Usage in assembleContext
async function assembleContext(message, sessionId, options = {}) {
  return getCachedOrEnrich(message, sessionId, async () => {
    // Full enrichment logic here
    const [ragContext, routeDecision] = await Promise.all([...]);
    return { ragContext, routeDecision, ... };
  });
}
```

**Expected Impact:** <10ms for cache hits (~20-30% of queries)

---

### 3.3 Adaptive top-K

**File:** `packages/context-pipeline/index.js`

**Implementation:**
```javascript
function determineTopK(route, priority) {
  const topKMap = {
    'claude_opus': { high: 15, medium: 10, low: 7 },
    'claude_sonnet': { high: 10, medium: 7, low: 5 },
    'claude_haiku': { high: 5, medium: 3, low: 2 },
    'local_qwen': { high: 5, medium: 3, low: 0 }, // No RAG for low-priority local
    'local_reasoning': { high: 10, medium: 7, low: 5 }
  };
  
  return topKMap[route]?.[priority] || 5;
}

async function assembleContext(message, sessionId, options = {}) {
  // ... skip logic ...
  
  // Get route decision first (if not using adaptive, run in parallel)
  const routeDecision = await routeToModel(message, shortTermHistory);
  
  // Adaptive top-K based on route
  const topK = determineTopK(routeDecision.route, routeDecision.priority);
  
  // Fetch RAG context with adaptive size
  const ragContext = topK > 0 
    ? await semanticSearch(message, { topK, sources: ['memory', 'chat', 'telegram'] })
    : [];
  
  // ...
}
```

**Expected Impact:** 30-50% faster for simple queries, same quality for complex

---

## Phase 4: Local Router (Speed Optimization)

**⚠️ ONLY after Phase 2 routing quality is validated ⚠️**

**Goal:** Replace Claude API router with local Qwen for speed/cost, but ONLY if quality is maintained.

### 4.1 Local Router Implementation

**File:** `packages/triage/router-local.js` (new)

**Implementation:**
```javascript
async function routeLocal(query, conversationHistory = []) {
  const ollamaUrl = config.ollama.url || 'http://127.0.0.1:11434';
  
  // Use the SAME enhanced prompt from Phase 2
  const prompt = buildEnhancedRouterPrompt(query, conversationHistory);
  
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5:14b',
      prompt,
      temperature: 0.1,
      stream: false,
      options: {
        num_predict: 150,
        stop: ['\n\n\n', '---']
      }
    }),
    signal: AbortSignal.timeout(5000)
  });
  
  const data = await response.json();
  return parseRouteResponse(data.response);
}
```

**A/B Testing Strategy:**
```javascript
async function routeToModel(query, conversationHistory = []) {
  const useLocal = Math.random() < 0.5; // 50% A/B split
  
  const [localResult, apiResult] = await Promise.all([
    routeLocal(query, conversationHistory).catch(() => null),
    routeViaAPI(query, conversationHistory)
  ]);
  
  // Log both for comparison
  if (localResult) {
    logABTest(query, localResult, apiResult);
  }
  
  // Return API result during testing phase
  return apiResult;
}

function logABTest(query, localResult, apiResult) {
  const db = new Database(config.paths.chatDb);
  
  db.prepare(`
    INSERT INTO ab_test_routing (timestamp, query, local_route, api_route, match)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    Date.now(),
    query.slice(0, 500),
    localResult.route,
    apiResult.route,
    localResult.route === apiResult.route ? 1 : 0
  );
  
  db.close();
}
```

**Validation Criteria (must meet ALL before rollout):**
- ✅ Agreement with Claude router: >90%
- ✅ Latency: <150ms (vs 500ms API)
- ✅ No increase in user complaints
- ✅ 2 weeks of A/B testing data

**Gradual Rollout:**
1. Week 1: 0% live (shadow mode - log only)
2. Week 2: 10% live (if >90% agreement)
3. Week 3: 50% live (if no issues)
4. Week 4: 100% live (if validated)

**Rollback Plan:**
```javascript
// Feature flag in config
const USE_LOCAL_ROUTER = config.contextPipeline.features.localRouter || false;

async function routeToModel(query, history) {
  if (USE_LOCAL_ROUTER) {
    try {
      return await routeLocal(query, history);
    } catch (err) {
      // Fallback to API
      return await routeViaAPI(query, history);
    }
  }
  
  return await routeViaAPI(query, history);
}
```

**Expected Impact:** 500ms → 50-100ms (10x faster), zero API cost

---

## Phase 5: Database + Model Tuning

### 5.1 Database Indexing

**File:** `packages/search/indexer.js`

**SQL Migrations:**
```sql
-- Check existing indexes
SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chunks';

-- Add if missing
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);

-- For chat_chunks
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_chunks(timestamp);
```

**Migration Script:**
```javascript
// packages/search/migrations/001_add_indexes.js
const Database = require('better-sqlite3');
const config = require('../../shared/config');

async function migrate() {
  const db = new Database(config.paths.searchDb);
  
  console.log('[migration] Adding indexes to chunks table...');
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);
  `);
  
  console.log('[migration] Indexes created successfully');
  db.close();
}

migrate().catch(err => {
  console.error('[migration] Failed:', err.message);
  process.exit(1);
});
```

**Expected Impact:** 10-20% faster queries

---

### 5.2 Embedding Model Evaluation

**Test Different Models:**
```javascript
// packages/embeddings/benchmark.js
const models = [
  { name: 'nomic-embed-text', dimension: 768 },
  { name: 'bge-small-en-v1.5', dimension: 384 },
  { name: 'all-minilm-l6-v2', dimension: 384 }
];

async function benchmarkModels() {
  const testQueries = [
    'Find my notes about project planning',
    'What did we discuss about optimizations?',
    'Show me corrections from yesterday'
  ];
  
  for (const model of models) {
    console.log(`\n=== ${model.name} ===`);
    
    for (const query of testQueries) {
      const start = Date.now();
      await getEmbedding(query, model.name);
      const duration = Date.now() - start;
      
      console.log(`  ${query.slice(0, 40)}: ${duration}ms`);
    }
  }
}
```

**Decision Criteria:**
- Speed vs. quality tradeoff
- Current: nomic-embed-text (768d, ~200ms)
- Alternative: bge-small (384d, ~100ms, -5% quality)

---

## Implementation Roadmap

### Week 1: Quality-Neutral Speed Wins (P1)
**Target:** 30-40% latency reduction WITHOUT affecting quality

- [ ] Day 1-2: Implement parallel execution (#1.1)
  - Update `context-pipeline/index.js`
  - RAG + routing run concurrently
  - Write tests
  - Deploy + monitor
  
- [ ] Day 3-4: Skip logic (#1.2)
  - Add `shouldEnrich()` function
  - Update entry point
  - Tests
  - Monitor skip rate (target: 50-60%)
  
- [ ] Day 5: Validation + monitoring
  - Verify quality maintained
  - Check routing accuracy
  - Dashboard metrics

**Success Metrics:**
- ✅ Avg enrichment: <2800ms (down from 4120ms)
- ✅ Skip rate: 50-60%
- ✅ Routing accuracy: NO REGRESSION

---

### Week 2: Routing Quality Improvements (P2) **← PRIORITY**
**Target:** 15-20% improvement in routing accuracy

- [ ] Day 1-2: Enhanced router prompt (#2.1)
  - Add few-shot examples
  - Update routing prompt
  - A/B test new vs old
  
- [ ] Day 3: Route validation & fallback (#2.2)
  - Implement confidence scoring
  - Add validation logic
  - Fallback to Sonnet on low confidence
  
- [ ] Day 4-5: Analytics + logging (#2.3)
  - Create route_decisions table
  - Log all routing decisions
  - Build analytics queries
  - Review routing patterns

**Success Metrics:**
- ✅ Routing accuracy: +15-20% (from baseline)
- ✅ Mis-routed queries: -30-40%
- ✅ Confidence scoring working
- ✅ Analytics dashboard updated

---

### Week 3: Caching + Two-Stage RAG (P3)
**Target:** Additional 20-30% speed improvement

- [ ] Day 1-2: Result caching (#3.2)
  - Create LRU cache layer
  - Integrate with assembleContext
  - Monitor hit rate (target: 20-30%)
  
- [ ] Day 3-4: Two-stage RAG (#3.1)
  - Implement pre-filter
  - Reranking logic
  - Benchmark improvements
  
- [ ] Day 5: Adaptive top-K (#3.3)
  - Route-based top-K selection
  - Tests + validation
  - Quality spot checks

**Success Metrics:**
- ✅ Cache hit rate: 20-30%
- ✅ Avg enrichment: <1500ms
- ✅ Quality maintained

---

### Week 4+: Local Router (P4) **⚠️ ONLY IF QUALITY VALIDATED**
**Target:** 10x routing speed (500ms → 50ms)

- [ ] Week 4: A/B testing setup
  - Implement local router (Qwen)
  - Shadow mode (log only, don't use)
  - 2 weeks of data collection
  
- [ ] Week 5-6: Gradual rollout
  - 10% traffic if >90% agreement
  - 50% traffic if no issues
  - 100% if fully validated
  
- [ ] Rollback plan ready at all times

**Validation Gates (MUST PASS ALL):**
- ✅ Agreement with Claude: >90%
- ✅ Latency: <150ms
- ✅ No user complaints
- ✅ 2 weeks clean data

**Success Metrics (if rolled out):**
- ✅ Avg routing: <100ms (vs 500ms)
- ✅ Zero API cost for routing
- ✅ Quality maintained

---

### Week 7: Polish (P5)
**Target:** Edge cases + optimizations

- [ ] Day 1: Database indexing (#5.1)
  - Write migration
  - Apply indexes
  - Benchmark
  
- [ ] Day 2-3: Embedding model evaluation (#5.2)
  - Test alternatives
  - Quality vs speed tradeoff
  
- [ ] Day 4-5: Documentation
  - Final performance report
  - Lessons learned
  - Maintenance guide

**Success Metrics:**
- ✅ Avg enrichment: <1000ms (80% of queries)
- ✅ P95 latency: <1500ms
- ✅ Zero quality regressions

---

## Testing Strategy

### Unit Tests
```javascript
// packages/context-pipeline/__tests__/optimizations.test.js
describe('Context Pipeline Optimizations', () => {
  describe('Parallel Execution', () => {
    it('should run RAG and routing in parallel');
    it('should handle errors in one path without blocking other');
  });
  
  describe('Local Router', () => {
    it('should route to correct model');
    it('should fallback to API on Ollama failure');
    it('should complete in <200ms');
  });
  
  describe('Skip Logic', () => {
    it('should skip simple messages');
    it('should enrich complex queries');
  });
  
  describe('Caching', () => {
    it('should cache results');
    it('should expire after TTL');
    it('should handle cache misses');
  });
});
```

### Integration Tests
```javascript
describe('End-to-End Enrichment', () => {
  it('should enrich complex query in <2000ms', async () => {
    const start = Date.now();
    const result = await assembleContext(
      'What are the optimization strategies we discussed for the context pipeline?',
      'test-session'
    );
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.ragContext.length).toBeGreaterThan(0);
  });
  
  it('should skip simple ack in <50ms', async () => {
    const start = Date.now();
    const result = await assembleContext('ok', 'test-session');
    expect(Date.now() - start).toBeLessThan(50);
    expect(result.metadata.skipped).toBe(true);
  });
});
```

### Performance Benchmarks
```javascript
// packages/context-pipeline/benchmark.js
async function runBenchmark() {
  const queries = [
    { text: 'ok', type: 'skip' },
    { text: 'find my notes about X', type: 'simple' },
    { text: 'Explain the architecture of the context pipeline with diagrams', type: 'complex' }
  ];
  
  console.log('=== Enrichment Benchmark ===\n');
  
  for (const q of queries) {
    const times = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await assembleContext(q.text, 'bench-session');
      times.push(Date.now() - start);
    }
    
    const avg = times.reduce((a, b) => a + b) / times.length;
    const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
    
    console.log(`${q.type.toUpperCase()}:`);
    console.log(`  Query: "${q.text.slice(0, 50)}..."`);
    console.log(`  Avg: ${avg.toFixed(0)}ms`);
    console.log(`  P95: ${p95}ms`);
    console.log('');
  }
}
```

---

## Monitoring & Metrics

### Dashboard Updates
Add to `packages/dashboard/public/index.html`:

```javascript
// Real-time performance tracking
const metrics = {
  avgLatency: 0,
  skipRate: 0,
  cacheHitRate: 0,
  routingTime: 0,
  ragTime: 0
};

// Update metrics panel
function renderMetrics() {
  return `
    <div class="metrics">
      <div class="metric">
        <label>Avg Latency</label>
        <value>${metrics.avgLatency}ms</value>
        <target>Target: <1500ms</target>
      </div>
      <div class="metric">
        <label>Skip Rate</label>
        <value>${(metrics.skipRate * 100).toFixed(1)}%</value>
        <target>Target: 50-60%</target>
      </div>
      <div class="metric">
        <label>Cache Hit Rate</label>
        <value>${(metrics.cacheHitRate * 100).toFixed(1)}%</value>
        <target>Target: 20-30%</target>
      </div>
    </div>
  `;
}
```

### Logging
```javascript
// packages/context-pipeline/index.js
function logEnrichmentMetrics(result, startTime) {
  const duration = Date.now() - startTime;
  
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'enrichment',
    duration,
    skipped: result.metadata.skipped || false,
    cacheHit: result.metadata.cacheHit || false,
    route: result.routeDecision.route,
    ragCount: result.ragContext.length,
    sessionId: result.metadata.sessionId
  }));
}
```

---

## Rollback Plan

If optimizations cause issues:

1. **Feature flags** for each optimization:
```javascript
const FEATURE_FLAGS = {
  PARALLEL_EXECUTION: true,
  LOCAL_ROUTER: true,
  SKIP_LOGIC: true,
  CACHING: true,
  ADAPTIVE_TOPK: true
};

if (FEATURE_FLAGS.PARALLEL_EXECUTION) {
  // New code
} else {
  // Old code
}
```

2. **Quick revert:**
```bash
# Disable specific optimization
node cli.js config set contextPipeline.features.localRouter false

# Full rollback
git revert <optimization-commit>
npm run restart
```

3. **Gradual rollout:**
- Week 1: Deploy to 10% of requests
- Week 2: 50% if no issues
- Week 3: 100% if stable

---

## Success Criteria

### Quality (PRIORITY)
- ✅ Routing accuracy: +15-20% improvement (Phase 2)
- ✅ Mis-routed queries: -30-40%
- ✅ Zero regression in RAG relevance (spot checks)
- ✅ Confidence scoring: <5% low-confidence routes
- ✅ No increase in user complaints
- ✅ Local router validation: >90% agreement with Claude (Phase 4)

### Performance
- ✅ Avg enrichment: <1500ms after P1-P3 (down from 4120ms)
- ✅ P95 enrichment: <2500ms
- ✅ Skip rate: 50-60%
- ✅ Cache hit rate: 20-30%
- ✅ Routing latency: <150ms (Phase 4, if local router deployed)

### Cost
- ✅ 50-60% reduction in API calls (from skips)
- ✅ Potential zero routing cost (Phase 4, if validated)
- ✅ ROI: ~$30-50/month savings from skips alone

### Validation Gates (Phase 4 Local Router)
**MUST PASS ALL before rollout:**
- ✅ 2 weeks of A/B testing data
- ✅ >90% agreement with Claude router
- ✅ <150ms latency (vs 500ms API)
- ✅ No increase in user feedback/complaints
- ✅ Clean rollback plan tested

---

## Next Steps

1. **Review this doc** with team
2. **Prioritize** any changes
3. **Kick off** with `/skill:claude-code-wingman`
4. **Monitor** dashboard metrics during rollout
5. **Iterate** based on real-world performance

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-30  
**Author:** Zoid (Opus)  
**Ready for:** Claude Code Wingman
