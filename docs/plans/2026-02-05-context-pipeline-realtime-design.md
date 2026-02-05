# Context Pipeline Real-Time Updates Design

**Date:** 2026-02-05
**Status:** Approved
**Author:** Claude (brainstorming session with user)

## Problem Statement

The Context Pipeline Hook dashboard currently requires manual refresh button clicks to see routing decisions. Users must repeatedly click "Refresh" to monitor routing activity in real-time, which is cumbersome when testing or debugging.

## Goal

Add real-time WebSocket updates to the Context Pipeline dashboard so that:
- Route distribution updates automatically
- Recent routing decisions table updates without refresh
- Total calls counter increments live
- Last call timestamp updates immediately
- Connection status is visible

## Constraints

- Must work with existing WebSocket infrastructure (`/ws` endpoint)
- Must gracefully degrade when WebSocket unavailable
- Must not break existing manual refresh functionality
- Must handle rapid-fire routing decisions without UI freezing
- **Security:** All user-generated content must be escaped via `escHtml()` for XSS defense

## Architecture Decision

**Choice:** Reuse existing WebSocket endpoint at `/ws`

**Rationale:**
- Single WebSocket connection per client (lower overhead)
- Consistent with current agent monitoring architecture
- Easier client-side connection management
- Message types already differentiated (`type: 'agent_state'`, `type: 'progress'`, etc.)
- Natural fit: add `type: 'context_pipeline_update'`

**Rejected Alternative:** Separate `/ws/context-pipeline` endpoint
- Would require multiple WebSocket connections per dashboard client
- More complex client-side management
- Higher resource usage
- Unnecessary separation for single-page dashboard

## Implementation Plan

### 1. Backend: Event Broadcasting

**File:** `packages/dashboard/server.js`

**Location:** After `contextPipelineActivity.push(...)` (around line 460)

**Changes:**
```javascript
// After logging activity to contextPipelineActivity array
contextPipelineActivity.push({ /* activity data */ });

// Broadcast to WebSocket clients
if (wsServer) {
  // Compute route distribution
  const routeCounts = {};
  for (const a of contextPipelineActivity.slice(-20)) {
    const r = a.routeDecision?.route || 'unknown';
    routeCounts[r] = (routeCounts[r] || 0) + 1;
  }

  wsServer.broadcast({
    type: 'context_pipeline_update',
    activity: {
      latest: contextPipelineActivity[contextPipelineActivity.length - 1],
      totalCalls: contextPipelineActivity.length,
      lastCall: contextPipelineActivity[contextPipelineActivity.length - 1].timestamp,
      routeDistribution: routeCounts,
    }
  });
}
```

**Key decisions:**
- Broadcast summary + latest entry (not full array) to minimize bandwidth
- Pre-compute route distribution on server (avoid client recalculation)
- Only broadcast last 20 entries' route distribution (matches API endpoint)

**No throttling needed:** Context pipeline enrichment calls are naturally rate-limited by user message frequency (typically 1-5/minute).

### 2. Frontend: WebSocket Listener

**File:** `packages/dashboard/public/index.html`

**Location:** Existing WebSocket message handler (around line 2970)

**Changes:**

**A. Add message handler:**
```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  // Existing handlers
  if (msg.type === 'status' || msg.type === 'agents') {
    // ... existing code ...
  }

  // NEW: Context pipeline updates
  if (msg.type === 'context_pipeline_update') {
    updateContextPipelineUI(msg.activity);
  }
};
```

**B. Incremental UI update function:**
```javascript
/**
 * Update Context Pipeline UI with new activity data (incremental, no full reload)
 *
 * Security: All user-generated content (query text, route names, reasons) is
 * escaped via escHtml() before insertion. Fixed colors/icons are safe literals.
 */
function updateContextPipelineUI(activity) {
  if (!activity) return;

  // Update status dot (safe: uses CSS variable)
  const statusDot = document.querySelector('#cp-status-dot');
  if (statusDot) {
    statusDot.style.background = activity.totalCalls > 0 ? 'var(--green)' : 'var(--yellow)';
  }

  // Update last call time (safe: textContent for plain text)
  const lastCallEl = document.querySelector('#cp-last-call');
  if (lastCallEl && activity.lastCall) {
    lastCallEl.textContent = new Date(activity.lastCall).toLocaleString();
  }

  // Update total calls (safe: textContent for number)
  const totalCallsEl = document.querySelector('#cp-total-calls');
  if (totalCallsEl) {
    totalCallsEl.textContent = activity.totalCalls;
  }

  // Update route distribution (safe: escHtml() for route names)
  if (activity.routeDistribution) {
    updateRouteDistribution(activity.routeDistribution, activity.totalCalls);
  }

  // Prepend latest decision row to table (safe: escHtml() for all user content)
  if (activity.latest) {
    prependDecisionRow(activity.latest);
  }
}

function updateRouteDistribution(routeCounts, total) {
  const container = document.querySelector('#cp-route-distribution');
  if (!container) return;

  // Safe color mapping (no user input)
  const routeColors = {
    claude_opus: '#e49cff',
    claude_sonnet: '#7eb8ff',
    claude_haiku: '#7effb2',
    local_qwen: '#ffcf7e',
    unknown: '#888',
  };

  let html = '';
  for (const [route, count] of Object.entries(routeCounts).sort((a,b) => b[1]-a[1])) {
    const color = routeColors[route] || 'var(--text2)';
    const pct = Math.round(count / total * 100);
    html += `<div style="text-align:center;min-width:80px">`;
    html += `<div style="font-size:24px;font-weight:700;color:${color}">${count}</div>`;
    html += `<div style="font-size:11px;color:var(--text2)">${escHtml(route)}</div>`; // Escaped
    html += `<div style="font-size:10px;color:var(--text2)">${pct}%</div>`;
    html += `</div>`;
  }

  /* Safety: All user-generated content (route name) is escaped via escHtml().
     Colors and counts are safe literals/numbers. Dashboard is localhost-only admin tool. */
  container.innerHTML = html;
}

function prependDecisionRow(log) {
  const tbody = document.querySelector('#cp-decisions-table tbody');
  if (!tbody) return;

  // Extract and escape all user-generated fields
  const time = new Date(log.timestamp).toLocaleTimeString();
  const queryText = typeof log.query === 'string' ? log.query : (log.query?.truncated || log.query?.fullText || '');
  const query = escHtml(queryText).slice(0, 60); // Escaped
  const fullQuery = escHtml(typeof log.query === 'string' ? log.query : (log.query?.fullText || '')); // For title
  const ragCount = log.ragContext?.count || 0;
  const route = log.routeDecision?.route || 'unknown';
  const model = (log.routeDecision?.clawdbotModel || '').split('/').pop() || '—';
  const reason = escHtml(log.routeDecision?.reason || '—'); // Escaped
  const timeMs = log.metadata?.assemblyTimeMs || 0;

  // Safe color mapping (no user input)
  const routeBadgeColors = {
    claude_opus: { bg: '#3d2050', fg: '#e49cff' },
    claude_sonnet: { bg: '#1e3050', fg: '#7eb8ff' },
    claude_haiku: { bg: '#1e4030', fg: '#7effb2' },
    local_qwen: { bg: '#403020', fg: '#ffcf7e' },
  };
  const badge = routeBadgeColors[route] || { bg: 'var(--bg3)', fg: 'var(--text2)' };

  const row = document.createElement('tr');
  row.style.borderBottom = '1px solid var(--bg3)';

  /* Safety: All user-generated content (query, route, model, reason) is escaped via escHtml().
     Colors and times are safe literals. Dashboard is localhost-only admin tool. */
  row.innerHTML = `
    <td style="padding:6px 8px;color:var(--text2);white-space:nowrap">${time}</td>
    <td style="padding:6px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${fullQuery}">${query || '<em>system</em>'}</td>
    <td style="padding:6px 8px;text-align:center">${ragCount}</td>
    <td style="padding:6px 8px;white-space:nowrap">
      <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${badge.bg};color:${badge.fg}">${escHtml(route)}</span>
      <span style="color:var(--text2);font-size:11px;margin-left:6px">→ ${escHtml(model)}</span>
    </td>
    <td style="padding:6px 8px;font-size:11px;color:var(--text2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${reason}">${reason}</td>
    <td style="padding:6px 8px;color:var(--text2);text-align:right">${timeMs}ms</td>
  `;

  tbody.insertBefore(row, tbody.firstChild);

  // Limit table to 20 rows (match API endpoint limit)
  while (tbody.children.length > 20) {
    tbody.removeChild(tbody.lastChild);
  }
}
```

**C. Update HTML structure in `loadContextPipeline()`:**
Add IDs to key elements for easy updates:
```html
<span id="cp-status-dot" style="width:8px;height:8px;border-radius:50%;background:var(--${statusColor})"></span>
<span id="cp-last-call">...</span>
<span id="cp-total-calls">...</span>
<div id="cp-route-distribution">...</div>
<table id="cp-decisions-table">...</table>
```

### 3. Connection Status & Error Handling

**State tracking variables:**
```javascript
let contextPipelineWsConnected = false;
let contextPipelineReconnectTimer = null;
```

**Connection handlers:**
```javascript
ws.onopen = () => {
  console.log('[WebSocket] Connected');
  contextPipelineWsConnected = true;
  updateConnectionIndicator('connected');

  if (contextPipelineReconnectTimer) {
    clearTimeout(contextPipelineReconnectTimer);
    contextPipelineReconnectTimer = null;
  }
};

ws.onclose = () => {
  console.log('[WebSocket] Disconnected');
  contextPipelineWsConnected = false;
  updateConnectionIndicator('disconnected');

  // Auto-reconnect after 5 seconds
  contextPipelineReconnectTimer = setTimeout(() => {
    console.log('[WebSocket] Attempting reconnect...');
    connectWs();
  }, 5000);
};

ws.onerror = (err) => {
  console.error('[WebSocket] Error:', err);
  contextPipelineWsConnected = false;
  updateConnectionIndicator('error');
};
```

**Connection indicator UI:**
```javascript
function updateConnectionIndicator(state) {
  const indicator = document.querySelector('#cp-ws-indicator');
  if (!indicator) return;

  const states = {
    connected: { icon: '🟢', text: 'Live', color: 'var(--green)' },
    disconnected: { icon: '🔴', text: 'Disconnected', color: 'var(--red)' },
    error: { icon: '🟡', text: 'Connecting...', color: 'var(--yellow)' },
  };

  const s = states[state] || states.disconnected;

  // Safe: uses textContent for icon/text (no user input)
  const iconSpan = document.createElement('span');
  iconSpan.textContent = s.icon;
  const textSpan = document.createElement('span');
  textSpan.style.color = s.color;
  textSpan.textContent = s.text;

  indicator.textContent = ''; // Clear
  indicator.appendChild(iconSpan);
  indicator.appendChild(document.createTextNode(' '));
  indicator.appendChild(textSpan);
}
```

**Add to Context Pipeline card HTML:**
```html
<div class="kv">
  <span class="k">Connection</span>
  <span id="cp-ws-indicator">🟡 Connecting...</span>
</div>
```

**Refresh button behavior:**
```javascript
function updateRefreshButton() {
  const btn = document.querySelector('#cp-refresh-btn');
  if (!btn) return;

  if (contextPipelineWsConnected) {
    btn.textContent = '↻ Refresh (Auto-updating)';
    btn.classList.add('outline'); // Dimmed appearance
    btn.title = 'Manual refresh (live updates active)';
  } else {
    btn.textContent = '↻ Refresh';
    btn.classList.remove('outline');
    btn.title = 'Click to refresh (WebSocket disconnected)';
  }
}
```

**Key principles:**
- **Always keep refresh button** - Safety net when WebSocket fails
- **Visual feedback** - Connection indicator shows real-time status
- **Auto-reconnect** - Retry every 5 seconds on disconnect
- **No data loss** - Manual refresh catches up if WebSocket drops

## Security Considerations

**XSS Defense Strategy:**
- All user-generated content (query text, route names, model names, routing reasons) is escaped via `escHtml()` before DOM insertion
- Fixed colors, icons, and timestamps are safe literals
- Dashboard is localhost-only admin tool (no authentication, loopback interface only)
- Defense-in-depth: `escHtml()` used even though data comes from local API

**Safe vs. Unsafe Fields:**
- ✅ Safe: Timestamps, counts, percentages, CSS color variables, emojis
- ⚠️ Escaped: Query text, route names, model names, routing reasons
- ✅ Safe DOM methods: `textContent` for plain text, `createElement()` for structure

## Testing Strategy

### Local Testing Sequence

**1. Start dashboard:**
```bash
cd ~/Projects/localllm-hub
node cli.js dashboard
```

**2. Trigger routing decisions:**

**Option A: Via Telegram** (real traffic)
- Send messages to Clawdbot via Telegram
- Watch dashboard update in real-time

**Option B: Via curl** (simulated)
```bash
curl -X POST http://localhost:3847/api/context-pipeline/enrich \
  -H "Content-Type: application/json" \
  -d '{"message": "test query", "sessionId": "test-session"}'
```

### Visual Confirmation Checklist

- [ ] Status dot turns green after first routing decision
- [ ] Total calls counter increments immediately (no manual refresh)
- [ ] Route distribution updates in real-time
- [ ] New rows appear at top of "Recent Routing Decisions" table
- [ ] Connection indicator shows 🟢 Live
- [ ] Last call timestamp updates immediately

### Edge Case Testing

**Rapid-fire requests:**
```bash
# Send 10 requests quickly
for i in {1..10}; do
  curl -X POST http://localhost:3847/api/context-pipeline/enrich \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"test query $i\", \"sessionId\": \"test\"}" &
done
wait
```
- [ ] UI doesn't freeze
- [ ] All 10 entries appear in table
- [ ] Route distribution accurate

**WebSocket disconnect/reconnect:**
- [ ] Stop dashboard server → indicator shows 🔴 Disconnected
- [ ] Restart dashboard → indicator shows 🟢 Live after ~5s
- [ ] Send routing decision → updates appear immediately

**Stale data on reconnect:**
- [ ] Disconnect WebSocket for 30 seconds
- [ ] Send 5 routing decisions via Telegram
- [ ] Reconnect → click manual refresh → all 5 appear

**Multiple browser tabs:**
- [ ] Open dashboard in 2 tabs
- [ ] Send routing decision
- [ ] Both tabs update simultaneously

**XSS defense:**
```bash
# Send query with HTML/JS in text
curl -X POST http://localhost:3847/api/context-pipeline/enrich \
  -H "Content-Type: application/json" \
  -d '{"message": "<script>alert(\"XSS\")</script>test", "sessionId": "test"}'
```
- [ ] Script tag appears as escaped text in table, not executed
- [ ] Query displays as `&lt;script&gt;...` in HTML source

## Rollout Plan

1. **Implement backend broadcast** (low risk - just adds broadcast call)
2. **Implement frontend listener** (low risk - additive, doesn't break refresh)
3. **Test with simulated curl requests** (verify mechanics work)
4. **Test XSS defense** (verify escHtml() works correctly)
5. **Test with real Telegram traffic** (verify production behavior)
6. **Monitor for 24 hours** (watch for edge cases)
7. **Remove old polling interval if stable** (optional cleanup)

## Performance Impact

**Bandwidth:**
- Message size: ~500 bytes per routing decision
- Frequency: 1-5 messages/minute during active use
- **Total:** ~150-1500 bytes/minute (negligible)

**CPU:**
- Event-driven updates (no polling overhead)
- Incremental DOM updates (no full rerender)
- **Impact:** Negligible

**Memory:**
- No additional state storage (reuses `contextPipelineActivity` array)
- Table limited to 20 rows (auto-truncated)
- **Impact:** Negligible

## Success Criteria

- [ ] Zero manual refreshes needed during normal use
- [ ] Updates appear within <500ms of routing decision
- [ ] WebSocket reconnects automatically on disconnect
- [ ] UI remains responsive during rapid-fire decisions
- [ ] Connection status always accurate
- [ ] Manual refresh still works when WebSocket down
- [ ] XSS defense confirmed (escHtml() working)

## Future Enhancements (Out of Scope)

- **Filtering:** Filter table by route type (show only `claude_opus` decisions)
- **Search:** Search routing reasons or query text
- **Export:** Download routing decisions as CSV/JSON
- **Alerts:** Browser notification when route switches to `claude_opus` (high cost)
- **Historical charts:** Route distribution over time (hourly/daily trends)

---

**Design approved:** 2026-02-05
**Ready for implementation:** Yes
