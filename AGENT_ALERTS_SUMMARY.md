# Agent Alert System - Implementation Summary

## What Was Built

Automatic notification system that alerts you via Telegram (through Clawdbot) when Claude Code agents get stuck, with dashboard controls to manage alerts.

## Key Components

### 1. AlertManager (`packages/dashboard/alert-manager.js`) ✨ NEW
- Prevents notification spam with 1-minute cooldowns
- Allows suppressing alerts for 30 minutes per session
- Auto-resets when agents resume activity
- Tracks alert state across all sessions

### 2. WebSocket Server Updates (`packages/dashboard/websocket-server.js`)
- ✅ Fixed notification command (was using non-existent `clawdbot gateway wake`)
- ✅ Now uses `clawdbot system event --text --mode now` for immediate alerts
- ✅ Integrated AlertManager to prevent spam
- ✅ Added handlers for suppress/unsuppress actions
- ✅ Improved message formatting with code blocks and dashboard links
- ✅ Auto-resets cooldown when agents resume from stuck state

### 3. Dashboard UI Updates (`packages/dashboard/public/index.html`)
- ✅ Added action buttons: 👋 Nudge, ❌ Kill, 🔕 Ignore 30m
- ✅ Styled buttons with color coding (red for kill, yellow for suppress)
- ✅ WebSocket integration for real-time actions
- ✅ Alert feedback via browser alerts

### 4. API Endpoints (`packages/dashboard/server.js`)
- ✅ `GET /api/alerts/states` - View all alert states
- ✅ `POST /api/alerts/:session/suppress` - Suppress alerts for duration
- ✅ `POST /api/alerts/:session/unsuppress` - Re-enable alerts

## How It Works

### Detection Flow

```
AgentMonitor (monitor.js)
  ↓ polls every 5 seconds
Detects agent idle for 5+ minutes
  ↓ emits 'agent_stuck' event
WebSocket Server (websocket-server.js)
  ↓ receives event
AlertManager checks: Should we alert?
  ├─ YES → Send Telegram alert via clawdbot
  │         Mark session as alerted (1 min cooldown)
  └─ NO  → Skip (cooldown active or suppressed)
```

### Alert Message Format

When an agent gets stuck, you receive this in Telegram:

```
⚠️ Agent `relationship-os-impl` stuck for 300s

Last output:
```
⏺ Write (components/Auth.tsx)
Task complete ✅
```

🔗 Dashboard: http://localhost:3847

💡 Actions: nudge, kill, or ignore via dashboard
```

### Dashboard Actions

**👋 Nudge** - Sends WebSocket message requesting Zoid to analyze the agent:
```
👤 Manual nudge requested for `session-name`

State: stuck (45%)
Idle: 315s

Last output: [...]

💡 Analyzing agent state...
```

**❌ Kill** - Terminates the tmux session immediately

**🔕 Ignore 30m** - Suppresses all alerts for this session for 30 minutes

## Files Modified/Created

### Created
- ✨ `packages/dashboard/alert-manager.js` - Alert state and cooldown manager
- ✨ `packages/dashboard/ALERT_SYSTEM.md` - Comprehensive documentation
- ✨ `packages/dashboard/test-alerts.sh` - Test script
- ✨ `AGENT_ALERTS_SUMMARY.md` - This file

### Modified
- 🔧 `packages/dashboard/websocket-server.js` - Fixed alerts, integrated AlertManager
- 🔧 `packages/dashboard/server.js` - Added alert API endpoints
- 🔧 `packages/dashboard/public/index.html` - Added action buttons, WebSocket integration

## Testing

### Quick Test
```bash
cd ~/Projects/localllm-hub
./packages/dashboard/test-alerts.sh
```

This script will:
1. ✅ Check if dashboard is running
2. ✅ Create a test tmux session with Claude Code-like output
3. ✅ Verify session is monitored
4. ✅ Test alert suppression API
5. ✅ Provide next steps for manual testing

### Manual Test

1. **Start dashboard:**
   ```bash
   cd ~/Projects/localllm-hub
   node cli.js dashboard
   ```

2. **Create a stuck agent:**
   ```bash
   tmux new-session -d -s relationship-os-test
   tmux send-keys -t relationship-os-test "echo '⏺ Write (test.js)'" Enter
   # Leave at prompt - will be detected as stuck after 5 min
   ```

3. **Open dashboard:**
   - Navigate to http://localhost:3847
   - Go to "🤖 Agent Monitor" tab
   - Click on the session to expand
   - Try the action buttons

4. **Check Telegram:**
   - After 5 minutes, you should receive an alert via Clawdbot
   - Message will include session name, idle time, and last output

## Configuration

### Alert Cooldown
Edit `packages/dashboard/alert-manager.js`:
```javascript
this.COOLDOWN_MS = 60000;  // 1 minute (default)
```

### Stuck Threshold
Edit `packages/agent-monitor/monitor.js`:
```javascript
const STUCK_THRESHOLD = 300;  // 5 minutes (default)
```

### Monitored Sessions
Edit `packages/dashboard/websocket-server.js` (line 76-81):
```javascript
const targetSessions = [
  'relationship-os-impl',
  'relationship-os-ios',
  'relationship-os-backend',
  'system-improvements',
  // Add your session names here
];
```

Or use auto-detection:
```javascript
this.monitor.start([]);  // Auto-detect all sessions
```

## Known Limitations

### Current Implementation
- ✅ Alerts via `clawdbot system event` (simple text notifications)
- ❌ No Telegram inline buttons yet (would require `clawdbot message send --buttons`)
- ✅ Dashboard buttons work via WebSocket
- ✅ Alert spam prevention with cooldowns

### Why Not Inline Buttons (Yet)?

Using `clawdbot message send --buttons` requires:
1. Knowing the Telegram chat ID (not in config)
2. Setting up callback handlers for button clicks
3. More complex integration

The current approach (`clawdbot system event`) is simpler and works immediately because:
- Triggers Clawdbot's heartbeat system (built-in notification)
- No need for chat IDs
- Dashboard provides full control

### Future Enhancement: Inline Buttons

To add Telegram inline buttons:

1. Get your Telegram chat ID:
   ```bash
   # Send a message to your Clawdbot
   # Then check:
   clawdbot message read --channel telegram --limit 1 --json | jq '.messages[0].chat.id'
   ```

2. Update `notifyZoid()` in `websocket-server.js`:
   ```javascript
   const buttons = JSON.stringify([
     [
       { text: '👋 Nudge', callback_data: `nudge:${data.session}` },
       { text: '❌ Kill', callback_data: `kill:${data.session}` }
     ],
     [
       { text: '🔕 Ignore 30m', callback_data: `suppress:${data.session}:30` }
     ]
   ]);

   execFile('clawdbot', [
     'message', 'send',
     '--channel', 'telegram',
     '--target', '<YOUR_CHAT_ID>',
     '--message', message,
     '--buttons', buttons
   ], ...);
   ```

3. Add Telegram callback handler in Clawdbot config or use webhooks

## Troubleshooting

### No alerts received

**Check Clawdbot status:**
```bash
clawdbot gateway status
```

**Check WebSocket connection:**
- Open browser console in dashboard
- Look for `[WebSocket] Connected`

**Check server logs:**
```bash
# In the dashboard server output, look for:
[WebSocket] ✅ Notified Zoid about agent_stuck for session-name
```

### Alerts not stopping (spam)

**Check alert states:**
```bash
curl http://localhost:3847/api/alerts/states | jq
```

**Manually suppress:**
```bash
curl -X POST http://localhost:3847/api/alerts/session-name/suppress \
  -H 'Content-Type: application/json' \
  -d '{"duration": 30}'
```

### Session not detected

**Check monitored sessions:**
Edit `packages/dashboard/websocket-server.js` line 76-81 to add your session name.

**Or use auto-detection:**
Sessions matching these patterns are auto-detected:
- `relationship-os-*`
- `system-improvements`
- `*claude*`
- `*omi*`

## Next Steps

1. **Test the system:**
   ```bash
   ./packages/dashboard/test-alerts.sh
   ```

2. **Add your session names** to the monitoring list in `websocket-server.js`

3. **Adjust thresholds** if 5 minutes is too long/short

4. **Optional: Add inline buttons** following the guide above

5. **Consider auto-recovery actions** (see `ALERT_SYSTEM.md` for examples)

## Success Metrics

When fully working, you should see:

✅ Telegram alert within 1 minute of agent getting stuck
✅ Only ONE alert per stuck state (no spam)
✅ Dashboard buttons trigger actions immediately
✅ Alert cooldown resets when agent resumes
✅ Suppress/unsuppress works from dashboard
✅ No alerts while suppressed

## Credits

Integrated with existing monitoring infrastructure:
- AgentMonitor (`packages/agent-monitor/monitor.js`) - Already detecting states
- WebSocket server - Already broadcasting events
- Dashboard - Already rendering agent list

This implementation adds:
- Spam prevention via AlertManager
- Proper Telegram integration via Clawdbot
- User controls for alert management
