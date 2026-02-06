# Agent Watcher

Real-time bi-directional communication between Zoid (orchestrator) and Claude Code agents running in tmux.

## Architecture

```
Zoid ◀──── webhook ──── Agent Watcher ◀──── tmux -C ──── Claude Code
                              │
                        parses signals:
                    :::DONE::: :::HELP:x::: etc
```

## Installation

```bash
cd ~/Projects/localllm-hub
npm install
```

### Install as Launchd Service (Recommended)

Run the watcher as a system daemon that auto-starts on login:

```bash
cd packages/agent-watcher
npm run install-service
```

This will:
- Install the watcher as a launchd user agent
- Configure it to start automatically on login
- Set up log files at `/tmp/agent-watcher.log`
- Enable persistence at `/tmp/agent-watcher-history.jsonl`

**Service management:**

```bash
# Check if running
launchctl list | grep agent-watcher

# Stop service
launchctl unload ~/Library/LaunchAgents/com.localllm.agent-watcher.plist

# Start service
launchctl load ~/Library/LaunchAgents/com.localllm.agent-watcher.plist

# View logs
tail -f /tmp/agent-watcher.log
```

## Usage

### Start the Watcher Daemon

Monitors all tmux sessions automatically:

```bash
npm start
# or
node cli.js start
```

The watcher will:
- Auto-discover new tmux sessions every 10s
- Parse signal markers in agent output
- Maintain state machines per session
- Send webhooks to Clawdbot when agents signal events
- Check for idle/stuck sessions every 60s

### Watch a Specific Session

```bash
node cli.js watch my-agent-session
```

### List Watched Sessions

```bash
node cli.js list
```

### Check Status

```bash
node cli.js status
```

Example output:
```
Session Status:
────────────────────────────────────────────────────────────────────────────────
my-agent: working (75%) - idle 2m
  Recent signals:
    [10:30:15] PROGRESS: 25
    [10:32:45] PROGRESS: 50
    [10:35:20] PROGRESS: 75
────────────────────────────────────────────────────────────────────────────────
```

## Signal Protocol

Agents output these markers for real-time monitoring:

| Signal | Example | Meaning |
|--------|---------|---------|
| `:::DONE:::` | `:::DONE:::` | Task complete (no details) |
| `:::DONE:summary:::` | `:::DONE:Built auth system:::` | Task complete with summary |
| `:::HELP:question:::` | `:::HELP:Use Redis or Postgres?:::` | Need user input |
| `:::ERROR:message:::` | `:::ERROR:npm install failed:::` | Hit an error |
| `:::BLOCKED:reason:::` | `:::BLOCKED:Need API key:::` | Blocked on something |
| `:::PROGRESS:N:::` | `:::PROGRESS:50:::` | Progress update (0-100) |

### For Claude Code Agents

Add this to your agent prompt injection (e.g., in `claude-code-wingman` skill):

```markdown
## 📡 Communication Protocol

Output these signals so I know your status:

- `:::PROGRESS:50:::` - You're 50% done
- `:::DONE:::` - Task complete
- `:::DONE:Built auth system:::` - Complete with summary
- `:::HELP:Should I use Redis or Postgres?:::` - Need my input
- `:::ERROR:npm install failed:::` - Hit a blocker
- `:::BLOCKED:Need API key:::` - Can't proceed without something

Output signals inline as you work. They're parsed automatically.
```

## Components

### 1. Signal Parser (`signal-parser.js`)

Regex-based parser for inline signals:

```javascript
const SignalParser = require('./signal-parser');

const signals = SignalParser.parse('Working... :::PROGRESS:50::: Almost there... :::DONE:::');
// Returns: [
//   { type: 'PROGRESS', payload: '50' },
//   { type: 'DONE', payload: '' }
// ]
```

### 2. Session State (`session-state.js`)

EventEmitter-based state machine:

```javascript
const { SessionState, States } = require('./session-state');

const state = new SessionState('my-session');

state.on('complete', (payload) => {
  console.log('Agent done:', payload);
});

state.handleSignal({ type: 'DONE', payload: 'Built 5 components' });
```

**States:** `spawned`, `working`, `waiting_input`, `done`, `error`, `cleaned`

**Events:** `complete`, `need_input`, `error`, `blocked`, `progress`

### 3. Tmux Control Mode (`tmux-control.js`)

Connects to tmux in control mode for real-time output streaming:

```javascript
const TmuxControlMode = require('./tmux-control');

const tmux = new TmuxControlMode();

await tmux.connect('my-session');

tmux.onOutput('my-session', (output) => {
  console.log('Agent output:', output);
});

tmux.sendKeys('my-session', 'echo hello', true);
```

### 4. Webhook Dispatcher (`webhook.js`)

Sends events to Clawdbot via `clawdbot gateway wake`:

```javascript
const WebhookDispatcher = require('./webhook');

const webhook = new WebhookDispatcher();

await webhook.dispatch('my-session', 'complete', 'Task finished');
// Sends: ✅ Agent `my-session` completed: Task finished
```

### 5. Agent Watcher (`watcher.js`)

Main daemon that ties everything together:

```javascript
const AgentWatcher = require('./watcher');

const watcher = new AgentWatcher({
  scanInterval: 10000,      // Scan for new sessions every 10s
  idleCheckInterval: 60000, // Check for stuck sessions every 60s
  idleThreshold: 300000,    // 5 minute idle threshold
  webhook: {
    enabled: true,
    endpoint: 'http://127.0.0.1:18789',
  },
});

await watcher.start();
```

### 6. Persistence (`persistence.js`)

Append-only JSONL logging for signal history. Enables state reconstruction after watcher restarts:

```javascript
const Persistence = require('./persistence');

const persist = new Persistence('/tmp/agent-watcher-history.jsonl');

// Log a signal
persist.logSignal('my-session', {
  type: 'PROGRESS',
  payload: '50',
  ts: Date.now()
});

// Restore session state after restart
const state = await persist.loadSessionState('my-session');
// Returns: { state: 'working', progress: 50, history: [...] }

// Get recent activity across all sessions
const recent = await persist.getRecentActivity(60); // last 60 minutes
```

**How it works:**

- Every signal is appended to a JSONL file as a single line (atomic write, no locking)
- On watcher restart, state is reconstructed by replaying signals from the log
- Enables reconnect to existing tmux sessions without losing context
- Fast tail/grep operations for debugging and analytics

**JSONL format:**

```json
{"session":"my-agent","type":"PROGRESS","payload":"25","ts":1707187234567}
{"session":"my-agent","type":"PROGRESS","payload":"50","ts":1707187245678}
{"session":"my-agent","type":"DONE","payload":"Task complete","ts":1707187256789}
```

## Testing

```bash
# Run test suite
npm test

# Manual testing
tmux new-session -d -s test-agent
tmux send-keys -t test-agent "echo ':::PROGRESS:25:::'" Enter
tmux send-keys -t test-agent "echo ':::DONE:Test complete:::'" Enter

# Should see webhook fire to Clawdbot
```

## Configuration

Set environment variables to customize behavior:

```bash
# Session scan interval (ms)
export WATCHER_SCAN_INTERVAL=10000

# Idle threshold before marking as stuck (ms)
export WATCHER_IDLE_THRESHOLD=300000

# Disable webhooks for testing
export WEBHOOK_ENABLED=false

# Start watcher
npm start
```

## Integration with Dashboard

The agent watcher data will be exposed via the localllm-hub dashboard at `http://localhost:3847`:

- Real-time session status
- Signal history per session
- Progress indicators
- Alert notifications

## Success Criteria

✅ `:::DONE:::` triggers Telegram notification within 1s
✅ `:::HELP:question:::` triggers notification with question
✅ `:::ERROR:msg:::` triggers notification with error
✅ Watcher auto-detects new tmux sessions
✅ Watcher survives session death gracefully
✅ Signals are persisted to JSONL log
✅ Watcher reconnects to existing sessions after restart
✅ Launchd service auto-starts on login
⏳ Dashboard shows real-time state per session (next: dashboard integration)

## Architecture Insights

★ **Signal-based IPC**: Uses inline markers in terminal output as a lightweight IPC mechanism. No file polling, no complex RPC - just regex parsing of stdout.

★ **Stateful tracking**: Each session has its own state machine (EventEmitter) that transitions through `spawned → working → done/error/waiting_input`. Events bubble up to webhooks.

★ **Tmux control mode**: The `-C` flag puts tmux in "control mode" where it outputs structured events like `%output %pane_id text` instead of terminal escape sequences. This makes parsing reliable.

★ **Graceful degradation**: If a session dies, the watcher cleans up and continues monitoring other sessions. If webhook dispatch fails, it logs but doesn't crash.

★ **Zero external dependencies**: Pure Node.js stdlib. Only runtime dependencies are tmux (for monitoring) and clawdbot CLI (for webhooks).

★ **Persistence via JSONL**: Append-only logging ensures signals are never lost. After a watcher restart (crash, system reboot), state is reconstructed by replaying the signal log. Fast, simple, debuggable.

## Next Steps

1. **Dashboard integration** - Add agent watcher panel to localllm-hub dashboard with live signal feed
2. **Wingman integration** - Update `claude-code-wingman` skill to inject signal protocol into prompts
3. **Advanced routing** - Route different signal types to different Clawdbot channels (errors → urgent, progress → status)
4. **Analytics** - Daily/weekly summaries of agent productivity (completion rate, average task duration, stuck sessions)
