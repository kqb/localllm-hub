# System Improvements: Routing, Memory Recall & Monitoring

**Date:** 2026-02-05  
**Trigger:** Critical failure in voice memo task — router underestimated complexity, memory recall failed, user had to manually herd agent through established workflow  
**Priority:** P0 — Directly impacts user trust

---

## Problem Statement

1. **Router routed complex tasks to Sonnet/Haiku** that required Opus-level reasoning + deep memory recall
2. **Memory recall is passive** — RAG injects context but agent doesn't verify or act on it
3. **User had to manually request Opus twice** — signals complete loss of trust in router
4. **Agent suggested manual workarounds** for systems we already built and automated

---

## Action Items

### 1. Router Improvements

#### 1.1 Add Historical Reference Signal Detection

**File:** `packages/context-pipeline/route-config.js`

Add pattern detection that forces Opus routing when user references established systems:

```javascript
const ESCALATION_SIGNALS = {
  // User referencing past work
  historical: [
    /we (did|built|have|made|created|setup) (this|that|it) before/i,
    /already (have|setup|built|made|created)/i,
    /you should (know|remember|recall)/i,
    /from (our|my) memory/i,
    /existing (setup|system|pipeline|project)/i,
    /use our/i,
    /we went thr(ough|u) this/i,
  ],
  
  // Known project names (auto-escalate to Opus)
  projects: [
    /live-translation-local/i,
    /exocortex/i,
    /relationship-os/i,
    /localllm-hub/i,
    /cascade-multiagent/i,
    /agent-orchestra/i,
  ],
  
  // Complex file/system access
  system_access: [
    /voice memo/i,
    /Library\/Group Containers/i,
    /\.exocortex/i,
    /ingest/i,
    /diariz/i,
  ],
  
  // Trust failure signals (IMMEDIATE Opus)
  trust_failure: [
    /route to opus/i,
    /previous model(s)? failed/i,
    /you keep (forgetting|fucking)/i,
    /why (can't|couldn't|didn't) you/i,
  ]
};
```

**Logic:**
- If `trust_failure` matches → Opus, no questions
- If `historical` + `projects` match → Opus
- If `historical` + RAG score > 0.7 → Opus
- If `projects` alone → minimum Sonnet, prefer Opus

#### 1.2 Track User-Requested Route Overrides

**File:** `packages/context-pipeline/index.js`

```javascript
// When user explicitly requests a model route
function detectManualRouting(message) {
  const patterns = [
    /route\s+to\s+(opus|sonnet|haiku)/i,
    /Router,?\s*please\s+route\s+to\s+(\w+)/i,
    /use\s+opus/i,
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        isManualOverride: true,
        requestedModel: match[1].toLowerCase(),
        timestamp: Date.now(),
        previousRoute: getCurrentRoute(),
        query: message,
      };
    }
  }
  return { isManualOverride: false };
}

// Log every manual override as a router failure
function logRouterFailure(override) {
  const failures = loadJSON('data/router-failures.jsonl');
  failures.push({
    ...override,
    previousQuery: getLastUserMessage(),
    previousRouteDecision: getLastRouteDecision(),
    ragScore: getLastRAGScore(),
  });
  appendJSONL('data/router-failures.jsonl', override);
  
  // Update dashboard metrics
  incrementMetric('router_manual_overrides');
}
```

#### 1.3 Confidence Threshold with Auto-Escalation

**File:** `packages/context-pipeline/route-config.js`

```javascript
function determineRoute(classification, ragContext) {
  const { complexity, ragScore, confidence } = classification;
  
  // Rule 1: Low confidence on complex task → Opus
  if (complexity >= 7 && confidence < 0.8) {
    return {
      route: 'claude_opus',
      reason: 'Low confidence on complex task - auto-escalating',
      autoEscalated: true,
    };
  }
  
  // Rule 2: High RAG score (found relevant memory) + complex → Opus
  if (ragScore >= 7 && complexity >= 6) {
    return {
      route: 'claude_opus',
      reason: 'Complex task with significant historical context',
    };
  }
  
  // Rule 3: Escalation signals detected → Opus
  if (hasEscalationSignals(classification.message)) {
    return {
      route: 'claude_opus',
      reason: 'Escalation signals detected in message',
      signals: getMatchedSignals(classification.message),
    };
  }
  
  // Default routing logic
  return defaultRoute(classification);
}
```

---

### 2. Memory Recall Improvements

#### 2.1 Mandatory Pre-Response Memory Verification

**File:** `packages/context-pipeline/index.js` (enrich function)

```javascript
async function enrichWithVerification(message, history) {
  const baseContext = await getRAGContext(message);
  
  // NEW: Mandatory project reference check
  const projectRefs = detectProjectReferences(message);
  let projectDocs = [];
  
  if (projectRefs.length > 0) {
    projectDocs = await searchProjectDocs(projectRefs);
    
    // Inject as HIGH PRIORITY context
    return {
      ragContext: baseContext,
      projectContext: projectDocs,
      verificationRequired: true,
      injectedPrompt: `🧠 MEMORY CHECK: Found ${projectDocs.length} relevant project docs for: ${projectRefs.join(', ')}. VERIFY these before responding. Do NOT suggest manual workarounds for established systems.`
    };
  }
  
  return { ragContext: baseContext };
}
```

#### 2.2 Index Project Documentation

**File:** `scripts/index-project-docs.sh` (NEW)

```bash
#!/bin/bash
# Index all project documentation into memory.db
# Run periodically via cron to keep docs fresh

MEMORY_DB="$HOME/clawd/scripts/memory.db"
SEARCH_SCRIPT="$HOME/clawd/scripts/semantic-search.js"

echo "📚 Indexing project documentation..."

# Projects to index
declare -A PROJECTS=(
  ["live-translation-local"]="$HOME/Documents/live-translation-local"
  ["localllm-hub"]="$HOME/Projects/localllm-hub"
  ["localllm-hub-v2"]="$HOME/Projects/localllm-hub-v2"
  ["relationship-os"]="$HOME/clawd/relationship-os"
  ["cascade-multiagent"]="$HOME/Projects/cascade-multiagent"
  ["agent-orchestra"]="$HOME/Projects/agent-orchestra"
)

# Files to index per project
DOC_FILES=(
  "README.md"
  "CLAUDE.md"
  "ARCHITECTURE.md"
  "CONTRIBUTING.md"
  "CHANGELOG.md"
)

for project in "${!PROJECTS[@]}"; do
  dir="${PROJECTS[$project]}"
  if [ -d "$dir" ]; then
    echo "  📁 $project ($dir)"
    for doc in "${DOC_FILES[@]}"; do
      if [ -f "$dir/$doc" ]; then
        echo "    ✅ $doc"
        # Index with project tag for priority retrieval
      fi
    done
  fi
done

# Force reindex
node "$SEARCH_SCRIPT" --index

echo "✅ Project documentation indexed"
```

#### 2.3 Track Memory Misses

**File:** `packages/context-pipeline/memory-tracker.js` (NEW)

```javascript
const { appendFileSync, existsSync, readFileSync } = require('fs');
const { join } = require('path');

const MISSES_FILE = join(__dirname, '../../data/memory-misses.jsonl');
const METRICS_FILE = join(__dirname, '../../data/memory-metrics.json');

function logMemoryMiss(data) {
  const entry = {
    timestamp: new Date().toISOString(),
    query: data.query,
    expectedKnowledge: data.expected,
    actualResponse: data.actual,
    correction: data.correction,
    ragScoreAtTime: data.ragScore,
    routeAtTime: data.route,
    herdingMessages: data.herdingCount || 0,
  };
  
  appendFileSync(MISSES_FILE, JSON.stringify(entry) + '\n');
  updateMetrics(entry);
}

function detectCorrectionSignal(message) {
  const signals = [
    /you should (have|know)/i,
    /we (did|built|have) this/i,
    /wrong project/i,
    /not that/i,
    /already have/i,
    /you keep forgetting/i,
    /why (can't|couldn't|didn't) you/i,
  ];
  
  return signals.some(s => s.test(message));
}

function updateMetrics(entry) {
  let metrics = {};
  if (existsSync(METRICS_FILE)) {
    metrics = JSON.parse(readFileSync(METRICS_FILE, 'utf8'));
  }
  
  const today = entry.timestamp.split('T')[0];
  if (!metrics[today]) {
    metrics[today] = {
      totalQueries: 0,
      memoryMisses: 0,
      manualOverrides: 0,
      herdingMessages: 0,
      avgRAGScore: 0,
    };
  }
  
  metrics[today].memoryMisses++;
  metrics[today].herdingMessages += entry.herdingMessages;
  
  require('fs').writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
}

module.exports = { logMemoryMiss, detectCorrectionSignal, updateMetrics };
```

---

### 3. Dashboard Upgrades

#### 3.1 New Dashboard Panels

**File:** `packages/dashboard/server.js` — Add new API endpoints

**Panel 1: Router Health**
```
GET /api/router/health
Response: {
  totalDecisions: 1234,
  manualOverrides: 12,        // User-requested route changes
  overrideRate: "0.97%",      // < 1% is healthy
  autoEscalations: 45,        // Router self-escalated
  modelDistribution: {
    opus: "10%",
    sonnet: "65%", 
    haiku: "25%"
  },
  avgConfidence: 0.82,
  last24h: {
    decisions: 89,
    overrides: 2,
    escalations: 5,
  }
}
```

**Panel 2: Memory Recall Performance**
```
GET /api/memory/performance
Response: {
  totalRecalls: 567,
  misses: 23,                 // Agent failed to recall known info
  missRate: "4.1%",           // < 10% target
  avgRAGScore: 7.2,
  herdingMessages: {
    avg: 1.8,                 // User corrections before success
    target: "< 2",
    trend: "improving"
  },
  topMissCategories: [
    { category: "project_reference", count: 8 },
    { category: "file_location", count: 6 },
    { category: "established_workflow", count: 5 },
  ],
  corrections: [              // Recent correction events
    { date: "2026-02-05", query: "voice memo", expected: "exocortex pipeline" },
  ]
}
```

**Panel 3: Trust Score**
```
GET /api/trust/score
Response: {
  score: 72,                  // 0-100
  trend: "declining",         // based on override frequency
  factors: {
    routerAccuracy: 85,       // % correct routes
    memoryRecall: 60,         // % first-try recall
    taskCompletion: 90,       // % tasks completed without help
    responseTime: 75,         // % fast enough responses
  },
  recentEvents: [
    { type: "manual_override", impact: -5, date: "2026-02-05" },
    { type: "memory_miss", impact: -3, date: "2026-02-05" },
    { type: "successful_recall", impact: +2, date: "2026-02-04" },
  ]
}
```

**Panel 4: Correction Timeline**
```
GET /api/corrections/timeline
Response: {
  daily: [
    { date: "2026-02-05", corrections: 3, overrides: 2 },
    { date: "2026-02-04", corrections: 1, overrides: 0 },
    ...
  ],
  weekly: [...],
  monthly: [...],
}
```

#### 3.2 Dashboard UI Components

**File:** `packages/dashboard/public/index.html` — Add new sections

```html
<!-- Router Health Panel -->
<div class="panel" id="router-health">
  <h3>🎯 Router Health</h3>
  <div class="metric-grid">
    <div class="metric">
      <span class="label">Override Rate</span>
      <span class="value" id="override-rate">0.97%</span>
      <span class="target">Target: < 1%</span>
    </div>
    <div class="metric">
      <span class="label">Auto-Escalations</span>
      <span class="value" id="auto-escalations">45</span>
    </div>
    <div class="metric">
      <span class="label">Avg Confidence</span>
      <span class="value" id="avg-confidence">82%</span>
    </div>
  </div>
  <div class="chart" id="route-distribution-chart"></div>
  <div class="chart" id="override-timeline-chart"></div>
</div>

<!-- Memory Performance Panel -->
<div class="panel" id="memory-performance">
  <h3>🧠 Memory Recall</h3>
  <div class="metric-grid">
    <div class="metric">
      <span class="label">Miss Rate</span>
      <span class="value" id="miss-rate">4.1%</span>
      <span class="target">Target: < 10%</span>
    </div>
    <div class="metric">
      <span class="label">Herding Messages</span>
      <span class="value" id="herding-avg">1.8</span>
      <span class="target">Target: < 2</span>
    </div>
    <div class="metric">
      <span class="label">Avg RAG Score</span>
      <span class="value" id="rag-score">7.2</span>
    </div>
  </div>
  <div class="chart" id="miss-categories-chart"></div>
  <div class="table" id="recent-corrections"></div>
</div>

<!-- Trust Score Panel -->
<div class="panel" id="trust-score">
  <h3>🤝 Trust Score</h3>
  <div class="trust-gauge">
    <svg viewBox="0 0 200 100"><!-- Gauge visualization --></svg>
    <span class="score" id="trust-value">72</span>
  </div>
  <div class="factors" id="trust-factors"></div>
  <div class="timeline" id="trust-events"></div>
</div>
```

#### 3.3 Real-Time Alert System

**File:** `packages/context-pipeline/alerts.js` (NEW)

```javascript
const THRESHOLDS = {
  overrideRate: { warn: 0.02, critical: 0.05 },  // 2% warn, 5% critical
  memoryMissRate: { warn: 0.15, critical: 0.25 }, // 15% warn, 25% critical
  herdingAvg: { warn: 2.5, critical: 4.0 },       // Messages before success
  trustScore: { warn: 60, critical: 40 },          // 0-100 scale
};

async function checkAlerts(metrics) {
  const alerts = [];
  
  if (metrics.overrideRate > THRESHOLDS.overrideRate.critical) {
    alerts.push({
      level: 'critical',
      message: `Router override rate at ${(metrics.overrideRate * 100).toFixed(1)}% — user trust critically low`,
      action: 'Review routing decisions, increase Opus allocation',
    });
  }
  
  if (metrics.memoryMissRate > THRESHOLDS.memoryMissRate.warn) {
    alerts.push({
      level: 'warn',
      message: `Memory miss rate at ${(metrics.memoryMissRate * 100).toFixed(1)}% — reindex recommended`,
      action: 'Run index-project-docs.sh, check RAG pipeline',
    });
  }
  
  if (metrics.herdingAvg > THRESHOLDS.herdingAvg.warn) {
    alerts.push({
      level: 'warn',
      message: `Avg herding messages: ${metrics.herdingAvg.toFixed(1)} — agent needs more proactive recall`,
      action: 'Review memory verification hook',
    });
  }
  
  // Send alerts to Telegram if critical
  for (const alert of alerts.filter(a => a.level === 'critical')) {
    await sendTelegramAlert(alert);
  }
  
  return alerts;
}

module.exports = { checkAlerts, THRESHOLDS };
```

---

### 4. Data Files & Storage

#### 4.1 New Data Files

```
localllm-hub/data/
├── router-failures.jsonl      # Every manual override event
├── memory-misses.jsonl        # Every memory recall failure
├── memory-metrics.json        # Daily aggregated metrics
├── trust-score.json           # Rolling trust score
├── corrections-log.jsonl      # User corrections timeline
└── escalation-log.jsonl       # Auto-escalation events
```

#### 4.2 Cron Jobs

```bash
# Daily metrics aggregation (midnight)
0 0 * * * node ~/Projects/localllm-hub/scripts/aggregate-metrics.js

# Project docs reindex (every 6 hours)
0 */6 * * * ~/clawd/scripts/index-project-docs.sh

# Trust score calculation (hourly)
0 * * * * node ~/Projects/localllm-hub/scripts/calculate-trust-score.js

# Alert check (every 15 minutes)
*/15 * * * * node ~/Projects/localllm-hub/scripts/check-alerts.js
```

---

### 5. Testing Plan

#### 5.1 Router Tests

```bash
# Test 1: Historical reference → should route to Opus
echo "Process the voice memo using our existing pipeline" | test-router
# Expected: claude_opus (historical + project reference)

# Test 2: Project name mention → should route to Opus  
echo "Check live-translation-local for the ingestion script" | test-router
# Expected: claude_opus (project reference)

# Test 3: Trust failure signal → IMMEDIATE Opus
echo "Route to opus, previous models failed" | test-router
# Expected: claude_opus (trust failure signal)

# Test 4: Simple question → should stay Haiku/Sonnet
echo "What time is it?" | test-router
# Expected: claude_haiku
```

#### 5.2 Memory Recall Tests

```bash
# Test 1: Known project reference
echo "Use our voice memo pipeline" | test-memory-recall
# Expected: Returns live-translation-local docs + exocortex info

# Test 2: File location recall
echo "Where are the voice memos stored?" | test-memory-recall
# Expected: ~/Library/Group Containers/group.com.apple.VoiceMemos.shared/

# Test 3: Workflow recall
echo "Ingest a new voice memo" | test-memory-recall
# Expected: Returns ingest_voice_memos_v2.py + full pipeline steps
```

---

### 6. Success Metrics (30-Day Targets)

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Manual route overrides | ~2/day | < 1/week | router-failures.jsonl |
| Memory miss rate | ~40% | < 10% | memory-misses.jsonl |
| Herding messages | 4-5 avg | < 2 avg | corrections-log.jsonl |
| Router confidence (complex) | ~70% | > 85% | route decisions log |
| First-response accuracy | ~60% | > 80% | manual review |
| Trust score | ~50 | > 80 | trust-score.json |

---

### 7. Implementation Order

1. **Router signal detection** (route-config.js) — highest impact
2. **Memory tracker** (memory-tracker.js) — enables measurement
3. **Dashboard panels** (server.js + index.html) — visibility
4. **Project docs indexing** (index-project-docs.sh) — improves recall
5. **Alert system** (alerts.js) — proactive monitoring
6. **Cron jobs** — automated maintenance
7. **Testing** — validate all changes

**Estimated time:** 4-6 hours for full implementation

---

**Owner:** Zoid (orchestrator) + Opus wingman (implementation)  
**Review:** Kat (validate metrics make sense)  
**Deadline:** 2026-02-05 EOD
