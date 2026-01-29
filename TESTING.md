# LocalLLM Hub — Testing & Integration Plan

## Overview

Four-phase approach: unit tests → shadow mode → canary rollout → full integration.
Each phase has clear pass/fail criteria before advancing.

---

## Phase 1: Unit Tests (Standalone Validation)

### 1.1 Classifier Tests

Test the rules engine against known email patterns. No Ollama required for rule-matched emails.

```bash
localllm classify --from "billing@stripe.com" --subject "Invoice #1234" --body "Amount due: $50"
# Expected: { category: "bills", confidence: 1, method: "rules" }

localllm classify --from "noreply@amazon.com" --subject "Your order has shipped" --body "Track delivery"
# Expected: { category: "shopping", confidence: 1, method: "rules" }

localllm classify --from "marketing.blast@spam.co" --subject "50% OFF" --body "Click to unsubscribe"
# Expected: { category: "junk", confidence: 1, method: "rules" }

localllm classify --from "careers@linkedin.com" --subject "New job matches" --body "5 new positions"
# Expected: { category: "jobs", confidence: 1, method: "rules" }

localllm classify --from "noreply@airbnb.com" --subject "Booking confirmed" --body "Check-in 3pm"
# Expected: { category: "travel", confidence: 1, method: "rules" }

localllm classify --from "alerts@chase.com" --subject "Transaction alert" --body "Debit $200"
# Expected: { category: "finance", confidence: 1, method: "rules" }

localllm classify --from "appointments@hospital.org" --subject "Appointment reminder" --body "Dr. Smith at 2pm"
# Expected: { category: "health", confidence: 1, method: "rules" }

localllm classify --from "legal@company.com" --subject "Updated terms of service" --body "Agreement changes"
# Expected: { category: "legal", confidence: 1, method: "rules" }
```

**LLM Fallback Tests** (requires Ollama):
```bash
localllm classify --from "friend@gmail.com" --subject "Dinner tonight?" --body "Want to grab sushi?"
# Expected: { category: "personal", method: "llm" }

localllm classify --from "random@unknown.org" --subject "Quick question" --body "Can you review this doc?"
# Expected: method: "llm", any reasonable category
```

**Pass criteria:** 100% rule-matched emails correct. 80%+ LLM fallback reasonable.

### 1.2 Embedding Tests

```bash
# Dimension check
localllm embed "hello world"
# Expected: 1024-dimensional vector

# Similarity — related concepts
localllm compare "cat" "dog"            # Expected: > 0.5
localllm compare "king" "queen"         # Expected: > 0.5
localllm compare "javascript" "python"  # Expected: > 0.4

# Dissimilarity — unrelated concepts
localllm compare "pizza" "quantum physics"  # Expected: < 0.3
localllm compare "soccer" "database"        # Expected: < 0.3

# Batch consistency
localllm batch-embed "hello" "world" "hello"
# Expected: embedding[0] == embedding[2] (identical inputs = identical outputs)
```

**Pass criteria:** Correct dimensions. Similar concepts > 0.4. Unrelated < 0.3. Batch deterministic.

### 1.3 Triage Tests

```bash
# Urgency spectrum
localllm triage "server is down, users can't access the app"     # Expected: 4-5
localllm triage "production database is corrupted"                # Expected: 5
localllm triage "can you update the README when you get a chance" # Expected: 1
localllm triage "we need to file taxes by April 15"               # Expected: 2-3
localllm triage "meeting in 30 minutes, need prep notes"          # Expected: 3-4
localllm triage "what's the weather like"                         # Expected: 1

# Routing
localllm route "what time is it in Tokyo"      # Expected: local
localllm route "refactor the authentication system across 5 microservices"  # Expected: api
localllm route "summarize this 3-line email"   # Expected: local
localllm route "debug this race condition in the distributed lock manager"  # Expected: api
```

**Pass criteria:** Urgency within ±1 of expected. Routing correct 80%+.

### 1.4 Search Tests

```bash
# Index known corpus
localllm reindex --source ~/clawd/memory --db /tmp/test-search.db

# Recall tests — search for known content
localllm search "Mastery project React TypeScript" --db /tmp/test-search.db
# Expected: finds 2026-01-26.md mastery references

localllm search "email classification rules" --db /tmp/test-search.db
# Expected: finds emailctl-related content

localllm search "Claude Code wingman tmux" --db /tmp/test-search.db
# Expected: finds coding-related memory entries

# Negative test
localllm search "underwater basket weaving techniques" --db /tmp/test-search.db
# Expected: low similarity scores (< 0.3) for all results
```

**Pass criteria:** Known content found in top-5 results. Irrelevant queries score < 0.3.

### 1.5 Transcriber Tests

```bash
# Help output
localllm transcribe --help
# Expected: shows options for model, language, threads

# Actual transcription (if whisper.cpp installed)
localllm transcribe ~/path/to/known-audio.wav
# Expected: text output matching known content

# Batch mode
localllm transcribe-batch ~/path/to/audio-dir --output ~/tmp/transcripts/
# Expected: one transcript per audio file
```

**Pass criteria:** CLI loads. Transcription output matches expected text ≥90% word accuracy.

### 1.6 Automated Test Runner

Location: `test/run-tests.sh`

```bash
#!/bin/bash
# Runs all unit tests, outputs pass/fail report
# Exit code 0 = all pass, 1 = failures

PASS=0
FAIL=0

run_test() {
  local name="$1"
  local cmd="$2"
  local expected="$3"
  
  result=$(eval "$cmd" 2>&1)
  if echo "$result" | grep -q "$expected"; then
    echo "✅ $name"
    ((PASS++))
  else
    echo "❌ $name"
    echo "   Expected: $expected"
    echo "   Got: $result"
    ((FAIL++))
  fi
}

echo "=== LocalLLM Hub Unit Tests ==="
echo ""

# Classifier rules
run_test "classify-bills" \
  'node cli.js classify --from billing@stripe.com --subject "Invoice" --body "Amount due"' \
  '"category": "bills"'

run_test "classify-shopping" \
  'node cli.js classify --from noreply@amazon.com --subject "Order shipped" --body "Track"' \
  '"category": "shopping"'

run_test "classify-junk" \
  'node cli.js classify --from marketing.spam@co.com --subject "Deal" --body "Unsubscribe"' \
  '"category": "junk"'

# Embeddings (requires Ollama)
run_test "embed-dimensions" \
  'node cli.js embed "hello" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))"' \
  "1024"

# Triage (requires Ollama)
run_test "triage-urgent" \
  'node cli.js triage "server is down" 2>/dev/null' \
  '"urgency"'

# Search
run_test "reindex" \
  'node cli.js reindex --source ~/clawd/memory --db /tmp/unit-test.db 2>&1' \
  "Saved"

run_test "search-recall" \
  'node cli.js search "project" --db /tmp/unit-test.db 2>/dev/null' \
  "Results"

# Transcriber
run_test "transcribe-help" \
  'node cli.js transcribe --help' \
  "Transcribe audio"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
```

---

## Phase 2: Shadow Mode (Parallel Comparison)

Run localllm-hub alongside current systems for 1 week. Log everything. Change nothing user-facing.

### 2.1 Shadow Logger

Location: `test/shadow-logger.js`

Wraps every localllm call and logs:
- Timestamp
- Command + args
- Output
- Latency (ms)
- Comparison with current system output (if applicable)

Log destination: `~/Projects/localllm-hub/test/shadow-logs/YYYY-MM-DD.jsonl`

### 2.2 Search Shadow

**What:** Every time Zoid runs `memory_search`, also run `localllm search` with the same query.

**How:** Add to Zoid's workflow (AGENTS.md or a helper script):
```bash
# After memory_search returns results, also:
node ~/Projects/localllm-hub/test/shadow-logger.js search "$QUERY"
```

**Compare:**
- Did localllm-hub find the same results?
- Did it find better results (relevant content memory_search missed)?
- Were there false positives (irrelevant results ranked high)?

**Log format:**
```json
{
  "ts": "2026-01-30T10:00:00Z",
  "query": "what did Kat say about auth",
  "localllm_results": [{"score": 0.62, "file": "2026-01-28.md", "line": 45}],
  "memory_search_results": [{"score": 0.48, "path": "memory/2026-01-28.md"}],
  "localllm_latency_ms": 340,
  "memory_search_latency_ms": 120,
  "verdict": "localllm_better"  // manual review field
}
```

**Review cadence:** After 50+ queries, generate comparison report.

**Pass criteria to advance:**
- localllm-hub finds relevant content ≥ as often as memory_search
- Latency < 2s per query
- No false positives in top-3 results

### 2.3 Classify Shadow

**What:** During heartbeat email checks, classify each email with localllm and log the result. Don't act on it.

**How:** Add to HEARTBEAT.md:
```
When checking emails, also run:
node ~/Projects/localllm-hub/test/shadow-logger.js classify --from <sender> --subject <subj>
```

**Log format:**
```json
{
  "ts": "2026-01-30T10:00:00Z",
  "email": {"from": "billing@stripe.com", "subject": "Invoice ready"},
  "classification": {"category": "bills", "confidence": 1, "method": "rules"},
  "latency_ms": 12,
  "human_label": null  // filled in during review
}
```

**Review cadence:** After 100+ emails, Kat reviews sample of 20 and labels them. Compare to localllm output.

**Pass criteria to advance:**
- Rule-matched: 95%+ accuracy
- LLM fallback: 80%+ accuracy
- Latency: < 100ms for rules, < 5s for LLM

### 2.4 Triage Shadow

**What:** For every user message Zoid processes, also run triage. Log the routing decision. Don't change routing.

**How:**
```bash
node ~/Projects/localllm-hub/test/shadow-logger.js triage "$USER_MESSAGE"
```

**Log format:**
```json
{
  "ts": "2026-01-30T10:00:00Z",
  "message": "what's the weather",
  "triage": {"urgency": 1, "route": "local"},
  "actual_handler": "claude-api",  // what actually happened
  "latency_ms": 890,
  "could_save": true  // would local have been sufficient?
}
```

**Review cadence:** Weekly. Calculate potential API savings.

**Pass criteria to advance:**
- Routing matches human judgment 85%+
- No critical messages (urgency 4-5) misrouted to local
- Potential API savings > 20% of total calls

---

## Phase 3: Canary Rollout (Staged Live Deployment)

### 3.1 Search Canary (Week 1)

**Action:** Replace `memory_search` fallback with localllm search for 1 full day.

**Rollback trigger:**
- Zoid fails to find known context 2+ times
- User says "you forgot" or "we talked about this" and search missed it
- Latency > 5s consistently

**If pass:** Keep localllm search as primary for 1 week. Monitor.

**Permanent switch criteria:** 1 week with no recall regressions.

### 3.2 Classify Canary (Week 2)

**Action:** Wire classification into heartbeat email checks. Start with **logging + junk filtering only**.

```
If classify → "junk" with confidence 1 and method "rules":
  Skip this email in digest
Else:
  Process normally
```

**Rollback trigger:**
- Important email classified as junk
- User asks "did I get an email from X?" and it was filtered

**Escalation path:** After 1 week of junk filtering, add bill/finance flagging (priority alerts).

### 3.3 Triage Canary (Week 3-4)

**Action:** Route only urgency-1 messages to local LLM.

```
If triage → urgency 1 AND route "local" AND confidence > 0.8:
  Use qwen2.5:7b via Ollama
Else:
  Use Claude API (normal path)
```

**Rollback trigger:**
- Local LLM gives wrong/useless answer
- User notices quality drop
- Latency > 10s for local responses

**Escalation path:**
- Week 3: urgency 1 only
- Week 4: urgency 1-2
- Week 5+: urgency 1-3 (if metrics hold)

---

## Phase 4: Full Integration

### 4.1 Config Changes

**AGENTS.md additions:**
```markdown
## Pre-Response Triage
Before using Claude API for a task, run:
  localllm triage "$MESSAGE"
If urgency ≤ 2 and route = "local" and confidence > 0.8:
  Use Ollama qwen2.5:7b directly
Otherwise: proceed with Claude API
```

**HEARTBEAT.md additions:**
```markdown
## Email Classification
During email checks:
1. Run: localllm classify --from <sender> --subject <subj> --body <body>
2. If "junk" → skip
3. If "bills" or "finance" → flag for Kat
4. If "health" or "legal" → alert immediately
5. Otherwise → include in normal digest
```

**Cron jobs:**
```bash
# Reindex memory every 6 hours
clawdbot cron add --name "localllm-reindex" --every "6h" \
  --system-event "Run: localllm reindex --source ~/clawd/memory --db ~/clawd/scripts/localllm-search.db"
```

### 4.2 Monitoring (Ongoing)

**Daily metrics** logged to `~/Projects/localllm-hub/metrics/YYYY-MM-DD.json`:
```json
{
  "date": "2026-02-05",
  "search": {
    "queries": 45,
    "avg_latency_ms": 280,
    "top1_relevant_pct": 82
  },
  "classify": {
    "emails_processed": 120,
    "rule_matched": 95,
    "llm_fallback": 25,
    "accuracy_sample": 0.93
  },
  "triage": {
    "messages_triaged": 30,
    "routed_local": 12,
    "routed_api": 18,
    "api_savings_pct": 40,
    "misroutes": 0
  },
  "ollama": {
    "uptime_pct": 99.5,
    "avg_embed_ms": 180,
    "avg_generate_ms": 2400
  }
}
```

**Alerts:**
- Ollama down > 5 min → notify Kat
- Classification accuracy drops below 85% → pause and review
- Triage misroutes critical message → immediately rollback to API-only

### 4.3 Rollback Plan

Every integration has a kill switch:

| Component | Rollback |
|-----------|----------|
| Search | Revert to `memory_search` tool (always available as fallback) |
| Classify | Remove classification block from HEARTBEAT.md, process all emails |
| Triage | Remove pre-response check from AGENTS.md, route everything to Claude API |
| Ollama | All components gracefully degrade — rules classifier works without Ollama, search falls back to memory_search |

---

## Timeline

| Week | Phase | Focus |
|------|-------|-------|
| 1 | Unit tests | Build `test/run-tests.sh`, validate all packages |
| 1-2 | Shadow: search | Compare localllm search vs memory_search |
| 2-3 | Shadow: classify | Log email classifications, review accuracy |
| 3-4 | Shadow: triage | Log routing decisions, calculate savings |
| 4 | Review | Analyze all shadow logs, decide go/no-go |
| 5 | Canary: search | Live search replacement (1 day → 1 week) |
| 6 | Canary: classify | Live junk filtering |
| 7-8 | Canary: triage | Route urgency-1 locally |
| 9+ | Full integration | All components live, monitoring active |

---

## Success Metrics (8-Week Target)

- **Search recall:** ≥ current memory_search quality
- **Classification accuracy:** ≥ 90% on known categories
- **Triage accuracy:** ≥ 85%, zero critical misroutes
- **API cost reduction:** 20-40% fewer Claude API calls via local routing
- **Latency:** embed < 500ms, classify rules < 50ms, classify LLM < 5s, triage < 5s, search < 2s
- **Ollama uptime:** > 99%
