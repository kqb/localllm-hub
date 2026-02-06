# Agent Watcher Specification

## Purpose

Real-time bi-directional communication between Zoid (orchestrator) and Claude Code agents running in tmux.

## Architecture

```
Zoid ◀──── webhook ──── Agent Watcher ◀──── tmux -C ──── Claude Code
                              │
                        parses signals:
                    :::DONE::: :::HELP:x::: etc
```

## Components

### 1. TmuxControlMode (`tmux-control.js`)

Connects to tmux in control mode for real-time output streaming.

```javascript
class TmuxControlMode {
  constructor() {
    this.connections = new Map(); // session -> subprocess
    this.listeners = new Map();   // session -> callback[]
  }

  // Connect to a session in control mode
  async connect(sessionName) {
    // tmux -C attach -t sessionName
    // Parse %output events
    // Call registered listeners with pane content
  }

  // Register output listener
  onOutput(sessionName, callback) {
    // callback(outputText) called on each %output event
  }

  // Disconnect from session
  disconnect(sessionName) {}

  // Send keys to session
  sendKeys(sessionName, text) {
    // tmux send-keys -t sessionName "text" Enter
  }
}
```

**tmux control mode protocol:**
- `%output %<pane_id> <base64_or_text>` - pane output
- `%session-changed` - session switch
- `%exit` - session ended

### 2. SignalParser (`signal-parser.js`)

Regex parser for inline signals in agent output.

```javascript
const SIGNAL_REGEX = /:::(DONE|HELP|ERROR|BLOCKED|PROGRESS):?([^:]*)?:::/g;

class SignalParser {
  static parse(text) {
    // Returns array of { type, payload }
    // e.g., ":::DONE:Built 5 components:::" 
    //    -> [{ type: 'DONE', payload: 'Built 5 components' }]
  }
}
```

**Signal types:**
| Signal | Regex | Payload |
|--------|-------|---------|
| `:::DONE:::` | DONE with optional payload | Summary of work |
| `:::DONE:summary:::` | | |
| `:::HELP:question:::` | HELP with required payload | Question for user |
| `:::ERROR:msg:::` | ERROR with required payload | Error description |
| `:::BLOCKED:reason:::` | BLOCKED with required payload | Why stuck |
| `:::PROGRESS:50:::` | PROGRESS with number | Percentage complete |

### 3. SessionState (`session-state.js`)

State machine per monitored session.

```javascript
const States = {
  SPAWNED: 'spawned',
  WORKING: 'working', 
  WAITING_INPUT: 'waiting_input',
  DONE: 'done',
  ERROR: 'error',
  CLEANED: 'cleaned'
};

class SessionState extends EventEmitter {
  constructor(sessionName) {
    this.session = sessionName;
    this.state = States.SPAWNED;
    this.progress = 0;
    this.lastActivity = Date.now();
    this.history = []; // last N signals
  }

  handleSignal(signal) {
    this.lastActivity = Date.now();
    this.history.push({ ...signal, ts: Date.now() });
    
    switch (signal.type) {
      case 'PROGRESS':
        this.progress = parseInt(signal.payload) || this.progress;
        this.state = States.WORKING;
        break;
      case 'HELP':
        this.state = States.WAITING_INPUT;
        this.emit('need_input', signal.payload);
        break;
      case 'ERROR':
        this.state = States.ERROR;
        this.emit('error', signal.payload);
        break;
      case 'DONE':
        this.state = States.DONE;
        this.progress = 100;
        this.emit('complete', signal.payload);
        break;
      case 'BLOCKED':
        this.state = States.WAITING_INPUT;
        this.emit('blocked', signal.payload);
        break;
    }
  }

  isIdle(thresholdMs = 300000) {
    return Date.now() - this.lastActivity > thresholdMs;
  }
}
```

### 4. WebhookDispatcher (`webhook.js`)

Sends events to Clawdbot gateway.

```javascript
class WebhookDispatcher {
  constructor(endpoint = 'http://127.0.0.1:18789') {
    this.endpoint = endpoint;
  }

  async dispatch(session, eventType, payload) {
    // Use clawdbot gateway wake for immediate notification
    const { execSync } = require('child_process');
    
    const message = this.formatMessage(session, eventType, payload);
    
    execSync(`clawdbot gateway wake --text "${message}" --mode now`, {
      timeout: 5000
    });
  }

  formatMessage(session, type, payload) {
    switch (type) {
      case 'complete':
        return `✅ Agent \`${session}\` completed: ${payload || 'done'}`;
      case 'need_input':
        return `❓ Agent \`${session}\` needs input: ${payload}`;
      case 'error':
        return `❌ Agent \`${session}\` error: ${payload}`;
      case 'blocked':
        return `🚫 Agent \`${session}\` blocked: ${payload}`;
      default:
        return `📊 Agent \`${session}\`: ${type} - ${payload}`;
    }
  }
}
```

### 5. AgentWatcher (`watcher.js`)

Main daemon that ties everything together.

```javascript
class AgentWatcher {
  constructor() {
    this.tmux = new TmuxControlMode();
    this.sessions = new Map();
    this.dispatcher = new WebhookDispatcher();
    this.parser = SignalParser;
  }

  async watchSession(sessionName) {
    if (this.sessions.has(sessionName)) return;

    const state = new SessionState(sessionName);
    this.sessions.set(sessionName, state);

    // Wire up events
    state.on('complete', (payload) => {
      this.dispatcher.dispatch(sessionName, 'complete', payload);
    });
    state.on('need_input', (payload) => {
      this.dispatcher.dispatch(sessionName, 'need_input', payload);
    });
    state.on('error', (payload) => {
      this.dispatcher.dispatch(sessionName, 'error', payload);
    });
    state.on('blocked', (payload) => {
      this.dispatcher.dispatch(sessionName, 'blocked', payload);
    });

    // Connect to tmux
    await this.tmux.connect(sessionName);
    
    this.tmux.onOutput(sessionName, (output) => {
      const signals = this.parser.parse(output);
      for (const signal of signals) {
        state.handleSignal(signal);
      }
    });

    console.log(`[Watcher] Now monitoring: ${sessionName}`);
  }

  async unwatchSession(sessionName) {
    this.tmux.disconnect(sessionName);
    this.sessions.delete(sessionName);
  }

  // Scan for new sessions periodically
  async scanSessions() {
    const { execSync } = require('child_process');
    const output = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf-8' });
    const sessions = output.trim().split('\n').filter(Boolean);
    
    for (const session of sessions) {
      if (!this.sessions.has(session)) {
        await this.watchSession(session);
      }
    }
  }

  // Check for idle/stuck sessions
  checkIdleSessions() {
    for (const [name, state] of this.sessions) {
      if (state.isIdle(300000) && state.state === 'working') {
        this.dispatcher.dispatch(name, 'stuck', `Idle for 5+ minutes`);
      }
    }
  }

  async start() {
    console.log('[Watcher] Starting agent watcher...');
    
    // Initial scan
    await this.scanSessions();
    
    // Periodic scan for new sessions (every 10s)
    setInterval(() => this.scanSessions(), 10000);
    
    // Check for stuck sessions (every 60s)
    setInterval(() => this.checkIdleSessions(), 60000);
  }
}

// Run as daemon
if (require.main === module) {
  const watcher = new AgentWatcher();
  watcher.start();
}

module.exports = AgentWatcher;
```

### 6. CLI (`cli.js`)

```javascript
#!/usr/bin/env node
const AgentWatcher = require('./watcher');

const watcher = new AgentWatcher();

const commands = {
  start: () => watcher.start(),
  watch: (session) => watcher.watchSession(session),
  unwatch: (session) => watcher.unwatchSession(session),
  list: () => console.log([...watcher.sessions.keys()].join('\n')),
  status: () => {
    for (const [name, state] of watcher.sessions) {
      console.log(`${name}: ${state.state} (${state.progress}%)`);
    }
  }
};

const [cmd, ...args] = process.argv.slice(2);
if (commands[cmd]) {
  commands[cmd](...args);
} else {
  console.log('Usage: agent-watcher <start|watch|unwatch|list|status> [args]');
}
```

## Signal Protocol (For Agent Prompts)

Add to wingman prompt injection:

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

## File Structure

```
packages/agent-watcher/
├── package.json
├── SPEC.md
├── cli.js
├── watcher.js
├── tmux-control.js
├── signal-parser.js
├── session-state.js
├── webhook.js
└── test/
    ├── signal-parser.test.js
    └── session-state.test.js
```

## Testing

```bash
# Start watcher
node cli.js start

# In another terminal, create test session
tmux new-session -d -s test-agent
tmux send-keys -t test-agent "echo ':::PROGRESS:25:::'" Enter
tmux send-keys -t test-agent "echo ':::DONE:Test complete:::'" Enter

# Should see webhook fire to Clawdbot
```

## Success Criteria

1. `:::DONE:::` triggers Telegram notification within 1s
2. `:::HELP:question:::` triggers notification with question
3. `:::ERROR:msg:::` triggers notification with error
4. Watcher auto-detects new tmux sessions
5. Watcher survives session death gracefully
6. Dashboard shows real-time state per session
