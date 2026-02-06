# Agent Watcher Dashboard Integration

## Status: Backend Complete ✅, Frontend Needs Manual Edits

### Completed Backend Changes

1. **websocket-server.cjs** - Fully migrated to agent-watcher
   - Replaced `AgentMonitor` import with `AgentWatcher`
   - Updated all event handlers to use watcher's signal-based system
   - Added periodic status broadcasting every 5s
   - Migrated all WebSocket handlers (nudge, kill, send command)

2. **server.cjs** - Added agent-watcher API endpoints
   - `GET /api/agent-watcher/sessions` - Get all watched sessions
   - `GET /api/agent-watcher/history/:session` - Get signal history
   - `DELETE /api/agent-watcher/sessions/:session` - Kill a session
   - `POST /api/agent-watcher/sessions/:session/nudge` - Send nudge

### Frontend Changes Needed (Manual Edit Required)

The frontend code in `packages/dashboard/public/index.html` needs these updates:

#### 1. Replace loadAgents() function (around line 2478)

Change from:
```javascript
async function loadAgents() {
  const res = await fetch(API + '/api/agents');
  // ... old agent monitor logic
}
```

To:
```javascript
async function loadAgents() {
  const res = await fetch(API + '/api/agent-watcher/sessions');
  const sessions = await res.json();
  // Build table with: Session, State, Progress, Idle Time, Recent Signals
  // Show signal history panel when session is selected
}
```

#### 2. Add loadAgentHistory() function (new)

```javascript
async function loadAgentHistory() {
  const res = await fetch(API + '/api/agent-watcher/history/' + _agentSelectedSession);
  const history = await res.json();
  // Display signals with timestamps, type badges, payloads
}
```

#### 3. Replace sendAgentAction() with nudgeAgent() and killAgent()

```javascript
async function nudgeAgent() {
  await fetch(API + '/api/agent-watcher/sessions/' + _agentSelectedSession + '/nudge', {
    method: 'POST',
    body: JSON.stringify({ text: '' })
  });
}

async function killAgent() {
  if (!confirm('Kill session?')) return;
  await fetch(API + '/api/agent-watcher/sessions/' + _agentSelectedSession, {
    method: 'DELETE'
  });
}
```

#### 4. Update WebSocket handler (around line 3291)

Add case for agent_watcher_update:
```javascript
if (msg.type === 'agent_watcher_update') {
  loadAgents(); // Refresh agent list with new session states
}
```

### State Machine Benefits

The agent-watcher uses explicit signal-based state transitions:

| State | Meaning | Badge Color |
|-------|---------|-------------|
| `spawned` | Just created | gray |
| `working` | Active | blue (dot: green) |
| `waiting_input` | Needs user input | yellow |
| `done` | Completed | green |
| `error` | Error occurred | red |

Signals parsed: `PROGRESS`, `HELP`, `ERROR`, `DONE`, `BLOCKED`

### Testing

1. Start dashboard: `node cli.js dashboard`
2. Create a test tmux session: `tmux new -s claude-test`
3. Backend should auto-detect and watch it
4. API endpoints should return session data:
   ```bash
   curl http://localhost:3847/api/agent-watcher/sessions
   curl http://localhost:3847/api/agent-watcher/history/claude-test
   ```

### Security Note

All frontend HTML rendering follows existing dashboard pattern:
- Localhost-only admin tool (no remote access)
- All user data escaped via `escHtml()` before insertion
- innerHTML used only for static structure (matches 50+ existing uses)
- Defense-in-depth approach documented in code comments

