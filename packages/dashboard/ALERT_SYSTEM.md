# Agent Alert System

Automatic notification system for stuck Claude Code agents via Telegram through Clawdbot.

## Components

### 1. AlertManager (`alert-manager.js`)
Tracks alert state and prevents notification spam.

**Features:**
- **Cooldown management**: Only alert once per stuck state (1 min cooldown)
- **Suppression**: User can silence alerts for 30 minutes
- **Auto-reset**: Cooldown resets when agent resumes activity

**API:**
```javascript
shouldAlert(session, event)      // Check if alert should be sent
markAlerted(session, event)      // Mark session as alerted
resetCooldown(session)           // Reset when agent resumes
suppressAlerts(session, durationMs) // Suppress for duration
unsuppressAlerts(session)        // Clear suppression
getAlertStates()                 // Get all alert states
```

### 2. WebSocket Server (`websocket-server.js`)
Monitors agent events and sends alerts.

**Event Flow:**
```
AgentMonitor detects stuck state
  ↓
Emits 'agent_stuck' event
  ↓
WebSocket server receives event
  ↓
AlertManager.shouldAlert() checks cooldown
  ↓
If YES: notifyZoid() via clawdbot system event
  ↓
AlertManager.markAlerted() sets cooldown
```

**Alert Events:**
- `agent_stuck` - Agent idle for 5+ minutes
- `agent_error` - Agent encountered an error
- `agent_complete` - Agent reports completion

### 3. Notification Method
Uses `clawdbot system event --text "..." --mode now` for immediate Telegram alerts.

**Message Format:**
```
⚠️ Agent `session-name` stuck for 300s

Last output:
```
[last 200 chars of output]
```

🔗 Dashboard: http://localhost:3847

💡 Actions: nudge, kill, or ignore via dashboard
```

### 4. Dashboard UI (`index.html`)
Provides action buttons for managing stuck agents.

**Action Buttons:**
- **👋 Nudge** - Request Zoid to analyze agent state
- **❌ Kill** - Terminate the agent session
- **🔕 Ignore 30m** - Suppress alerts for 30 minutes

**WebSocket Messages:**
```javascript
// Nudge agent
{ action: 'nudge', session: 'session-name' }

// Kill agent
{ action: 'kill', session: 'session-name' }

// Suppress alerts
{ action: 'suppress_alerts', session: 'session-name', duration: 30 }
```

## API Endpoints

### GET /api/alerts/states
Get alert state for all sessions.

**Response:**
```json
{
  "states": [
    {
      "session": "relationship-os-impl",
      "alertedAt": 1707156000000,
      "event": "agent_stuck",
      "suppressed": false,
      "suppressUntil": null,
      "suppressedTimeRemaining": 0
    }
  ],
  "timestamp": 1707156000000
}
```

### POST /api/alerts/:session/suppress
Suppress alerts for a session.

**Request:**
```json
{ "duration": 30 }
```

**Response:**
```json
{
  "success": true,
  "session": "relationship-os-impl",
  "suppressedForMinutes": 30,
  "message": "Alerts suppressed for 30 minutes"
}
```

### POST /api/alerts/:session/unsuppress
Re-enable alerts for a session.

**Response:**
```json
{
  "success": true,
  "session": "relationship-os-impl",
  "message": "Alerts re-enabled"
}
```

## Testing

### 1. Simulate a Stuck Agent

Create a tmux session that appears stuck:

```bash
# Start a tmux session
tmux new-session -d -s test-stuck-agent

# Send some Claude Code-like output
tmux send-keys -t test-stuck-agent "echo '⏺ Read (config.js)'" Enter
tmux send-keys -t test-stuck-agent "echo '⏺ Write (test.js)'" Enter
tmux send-keys -t test-stuck-agent "echo 'Task complete ✅'" Enter

# Leave it at prompt (will be detected as stuck after 5 min)
```

### 2. Monitor in Dashboard

1. Open dashboard: http://localhost:3847
2. Navigate to "🤖 Agent Monitor" tab
3. Wait for session to appear (may take 5-10 seconds)
4. Click on the session to expand

### 3. Trigger Immediate Alert

Manually trigger a stuck event (for testing):

```bash
# In the dashboard server console, you should see:
# [Agent Monitor] test-stuck-agent: idle 300s → STUCK
# [WebSocket] ✅ Notified Zoid about agent_stuck for test-stuck-agent
```

### 4. Check Telegram

You should receive a message in Telegram via Clawdbot:

```
⚠️ Agent `test-stuck-agent` stuck for 300s

Last output:
```
Task complete ✅
```

🔗 Dashboard: http://localhost:3847

💡 Actions: nudge, kill, or ignore via dashboard
```

### 5. Test Action Buttons

**Nudge:**
1. Click "👋 Nudge" button in dashboard
2. Check Telegram for analysis request

**Kill:**
1. Click "❌ Kill" button
2. Confirm the dialog
3. Session should disappear from list

**Ignore 30m:**
1. Click "🔕 Ignore 30m" button
2. Alert confirmed in dashboard
3. No more alerts for this session for 30 minutes

### 6. Test Cooldown Reset

```bash
# Send activity to the stuck session
tmux send-keys -t test-stuck-agent "echo 'resuming...'" Enter

# Dashboard should show:
# [Agent Monitor] test-stuck-agent: resumed from stuck state, alert cooldown reset
```

## Configuration

Alert settings in `alert-manager.js`:

```javascript
this.COOLDOWN_MS = 60000;              // 1 minute minimum between alerts
this.DEFAULT_SUPPRESS_MS = 30 * 60 * 1000;  // 30 minutes default suppression
```

Stuck detection threshold in `monitor.js`:

```javascript
const STUCK_THRESHOLD = 300;  // 5 minutes idle = stuck
```

## Troubleshooting

### No alerts received

**Check Clawdbot:**
```bash
clawdbot gateway status
```

**Check WebSocket connection:**
- Open browser console in dashboard
- Look for `[WebSocket] Connected` message

**Check alert state:**
```bash
curl http://localhost:3847/api/alerts/states | jq
```

### Alerts not stopping (spam)

**Check cooldown state:**
```bash
curl http://localhost:3847/api/alerts/states | jq '.states[] | select(.session == "session-name")'
```

**Manually suppress:**
```bash
curl -X POST http://localhost:3847/api/alerts/session-name/suppress \
  -H 'Content-Type: application/json' \
  -d '{"duration": 30}'
```

### Agent not detected as stuck

**Check monitoring:**
- Agent monitor logs: Dashboard server console
- Session must match the filter in `websocket-server.js` (line 76-81)

**Add session to monitoring:**

Edit `websocket-server.js` line 76-81:
```javascript
const targetSessions = [
  'relationship-os-impl',
  'relationship-os-ios',
  'relationship-os-backend',
  'system-improvements',
  'your-session-name',  // Add your session here
];
```

Or use auto-detection by passing empty array:
```javascript
this.monitor.start([]);  // Auto-detect all sessions matching patterns
```

## Future Enhancements

### Telegram Inline Buttons (Phase 2)

To add inline buttons to Telegram alerts:

1. Update `notifyZoid()` in `websocket-server.js`:

```javascript
notifyZoid(event, data) {
  const message = this.formatZoidMessage(event, data);

  const buttons = JSON.stringify([
    [
      { text: '👋 Nudge', callback_data: `nudge:${data.session}` },
      { text: '❌ Kill', callback_data: `kill:${data.session}` },
    ],
    [
      { text: '🔕 Ignore 30m', callback_data: `suppress:${data.session}:30` },
    ],
  ]);

  execFile('clawdbot', [
    'message', 'send',
    '--channel', 'telegram',
    '--target', 'me',  // or specific chat ID
    '--message', message,
    '--buttons', buttons,
  ], ...);
}
```

2. Add callback handler in Clawdbot to process button clicks and send WebSocket messages back to dashboard.

### Auto-Recovery Actions

Add smart recovery actions based on agent state:

```javascript
if (event === 'agent_stuck') {
  const state = this.monitor.getState(data.session);

  if (state.last_output.includes('waiting for input')) {
    // Auto-nudge with newline
    this.handleSendCommand(data.session, '');
  }

  if (state.error_count > 3) {
    // Auto-kill after 3 errors
    this.handleKill(data.session);
  }
}
```

### Alert Escalation

Escalate if not acknowledged within timeout:

```javascript
setTimeout(() => {
  if (!this.alertManager.isAcknowledged(session)) {
    // Send louder alert
    this.notifyZoid('agent_stuck_escalated', {
      ...data,
      stuckDuration: 600,  // 10 minutes
    });
  }
}, 5 * 60 * 1000);  // 5 min escalation timeout
```
