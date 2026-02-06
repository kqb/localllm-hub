# Self-Healing Log

**Feature:** Timeline dashboard panel that tracks Zoid's autonomous improvements

**Status:** ✅ Complete and deployed

---

## What It Does

Captures pattern → diagnosis → approach → result entries every time Zoid identifies and fixes a problem autonomously. Think of it as a learning journal that shows:

- **Pattern:** What symptom was observed
- **Diagnosis:** What root cause was identified
- **Approach:** What actions were taken
- **Result:** What the outcome was

This creates a searchable history of improvements, making it easy to:
- Track recurring issues
- Learn from past fixes
- Share knowledge across sessions
- Demonstrate continuous improvement

---

## Architecture

### Backend

**Module:** `packages/dashboard/self-heal-log.cjs`

- In-memory log with file persistence
- Auto-loads on startup from `~/.clawdbot/self-heal-log.json`
- Max 100 entries (FIFO circular buffer)
- Simple ID generation (timestamp + crypto.randomBytes)

**API Endpoints:**

```
POST /api/self-heal/log
  Body: { pattern, diagnosis, approach, result, category, status }
  Returns: { success, entry }

GET /api/self-heal/log?limit=50
  Returns: { entries, count }

GET /api/self-heal/stats
  Returns: { total, byCategory, byStatus }
```

### Frontend

**Location:** Panel #5 in `packages/dashboard/public/index.html`

**Features:**
- Timeline cards (expandable)
- Category filters: RAG, Config, Performance, Other
- Status indicators: Fixed, Monitoring, Investigating
- Stats summary bar
- 60s auto-refresh

**Security:** DOM-based rendering with `textContent` (no innerHTML with user data)

---

## Usage

### Manual Logging (Shell)

```bash
~/clawd/scripts/log-self-heal.sh CATEGORY STATUS \
  "Pattern observed" \
  "Diagnosis of root cause" \
  "Approach taken" \
  "Result achieved"
```

**Example:**
```bash
~/clawd/scripts/log-self-heal.sh rag fixed \
  "RAG returning noise on every query" \
  "Session dumps in memory/ folder with common terms" \
  "Deleted 3 noise files, reindexed memory.db" \
  "Passport noise eliminated, relevant results now"
```

### Programmatic Logging (API)

```bash
curl -X POST http://localhost:3847/api/self-heal/log \
  -H "Content-Type: application/json" \
  -d '{
    "category": "rag",
    "status": "fixed",
    "pattern": "Problem description",
    "diagnosis": "Root cause analysis",
    "approach": "Actions taken",
    "result": "Outcome achieved"
  }'
```

### From JavaScript

```javascript
await fetch('http://localhost:3847/api/self-heal/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    category: 'performance',
    status: 'monitoring',
    pattern: 'Slow embedding queries (>5s)',
    diagnosis: 'SQLite sequential scan, no index on embedding column',
    approach: 'Added vector index, preload to memory on startup',
    result: 'Queries now 20ms, will monitor for regression'
  })
});
```

---

## Categories

- **rag:** Issues with retrieval-augmented generation (search quality, indexing, chunking)
- **config:** Configuration problems (timeouts, URLs, paths, model selection)
- **performance:** Speed/memory optimizations (caching, indexing, batching)
- **other:** Everything else

---

## Status Values

- **fixed:** Problem resolved, no further action needed
- **monitoring:** Fix applied, watching for regression or side effects
- **investigating:** Diagnosis in progress, no solution yet

---

## Data Model

```typescript
interface SelfHealEntry {
  id: string;                    // Generated: timestamp-randomhex
  timestamp: string;              // ISO-8601
  pattern: string;                // Observable symptom
  diagnosis: string;              // Root cause analysis
  approach: string;               // Actions taken (can be multiline)
  result: string;                 // Outcome achieved
  category: 'rag' | 'config' | 'performance' | 'other';
  status: 'fixed' | 'monitoring' | 'investigating';
}
```

**Storage:** `~/.clawdbot/self-heal-log.json` (pretty-printed JSON array)

---

## Seed Data

One example entry is included to demonstrate the UI:

```json
{
  "pattern": "RAG returning passport image on every query (score 0.94)",
  "diagnosis": "Session dumps written to memory/ during compaction. Contains common terms (telegram, session, assistant) that match all queries.",
  "approach": "1. Identified 6 session dump files\n2. Deleted 3 pure-noise files\n3. Reindexed memory.db (547 chunks)\n4. Verified fix with test query",
  "result": "Passport noise eliminated. 'are you alive' now returns relevant crash-prevention guide.",
  "category": "rag",
  "status": "fixed"
}
```

---

## Integration with Zoid

Zoid can log entries automatically when:
- Detecting and fixing noise in RAG results
- Adjusting config after repeated failures
- Optimizing slow operations
- Recovering from errors autonomously

**Pattern:**
1. Detect problem (alerts, metrics, user feedback)
2. Diagnose root cause (analyze logs, test queries, inspect state)
3. Apply fix (delete files, adjust config, reindex, restart service)
4. Verify result (test query, check metrics)
5. Log to self-heal panel via API or shell script

**When to log:**
- After completing a fix (not during)
- When the action was autonomous (not user-directed)
- When the learning would be valuable for future reference

---

## Future Enhancements

- [ ] Search/filter by pattern keywords
- [ ] Group related entries (e.g., "RAG quality" theme)
- [ ] Trend analysis (are we fixing the same issue repeatedly?)
- [ ] Export to markdown for MEMORY.md integration
- [ ] Trigger alerts when patterns recur within N days
- [ ] Link entries to related Zoid Activity Log actions

---

## Files Modified

**New files:**
- `packages/dashboard/self-heal-log.cjs` — Backend module
- `~/clawd/scripts/log-self-heal.sh` — Logging helper script
- `~/.clawdbot/self-heal-log.json` — Persistent storage (created on first use)
- `docs/SELF_HEALING_LOG.md` — This documentation

**Modified files:**
- `packages/dashboard/server.cjs` — Added 3 API endpoints
- `packages/dashboard/public/index.html` — Added panel HTML, CSS, JavaScript
- `CLAUDE.md` — Updated API endpoints table, frontend panels list, quick reference

---

## Verification

```bash
# Start dashboard (if not running)
cd ~/Projects/localllm-hub && node cli.js dashboard

# Open in browser
open http://localhost:3847

# Look for "🔧 Self-Healing Log" panel
# Should show 1 seed entry (passport noise fix)

# Test logging
~/clawd/scripts/log-self-heal.sh config fixed \
  "Test entry" \
  "Test diagnosis" \
  "Test approach" \
  "Test result"

# Refresh dashboard — new entry should appear
```

---

## Security Model

- **Localhost-only:** Dashboard binds to `127.0.0.1:3847` (no external access)
- **No authentication:** Admin tool, assumes trusted environment
- **DOM rendering:** Uses `textContent` for user data (XSS-safe)
- **Input validation:** Required fields enforced, categories/statuses restricted to enum

This matches the security model used throughout the dashboard (see Zoid Activity Log, Agent Monitor).

---

## Credits

**Design pattern:** Inspired by Zoid Activity Log (simple, functional, no bloat)
**Implementation:** Pure Node.js + vanilla JS (no frameworks, no dependencies)
**Philosophy:** Dashboard-first (every feature needs a UI panel)
