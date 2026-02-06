# Agent Interaction Architecture: Real-Time Bidirectional Control

**Problem:** Current agent monitoring is passive (cron-based polling). No real-time interaction between Zoid and agents. Nudge button is blind (just sends Enter). Progress tracking doesn't work.

**Solution:** Real-time event-driven architecture with WebSocket communication, agent state detection, and Zoid integration for intelligent intervention.

---

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Dashboard (Browser)                   │
│  - Real-time agent status via WebSocket                     │
│  - Interactive controls (nudge, send instructions, kill)    │
│  - Conversation view: Zoid ↔ Agent messages                 │
│  - Progress bars (file tracking, milestone completion)      │
└─────────────────┬───────────────────────────────────────────┘
                  │ WebSocket (bidirectional)
                  ↓
┌─────────────────────────────────────────────────────────────┐
│              Dashboard WebSocket Server                      │
│  packages/dashboard/websocket-server.js                     │
│  - Broadcasts agent events to all connected clients         │
│  - Receives user actions (nudge, command, kill)             │
│  - Routes events to Agent Monitor                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────────────────┐
│                  Agent Monitor Service                       │
│  packages/agent-monitor/monitor.js                          │
│  - Watches tmux sessions (tmux control mode or polling)     │
│  - Detects agent states: thinking, idle, stuck, error       │
│  - Parses Claude Code output for progress indicators        │
│  - Emits events: state_change, needs_attention, progress    │
│  - Maintains agent state database (SQLite)                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────────────────┐
│                  Zoid Integration (Clawdbot)                 │
│  ~/.clawdbot/extensions/agent-interaction/                  │
│  - Receives agent events via clawdbot gateway wake          │
│  - Analyzes agent state and decides intervention            │
│  - Sends instructions to Agent Command Queue                │
│  - Logs conversation (Zoid ↔ Agent) to dashboard            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────────────────┐
│               Agent Command Queue (Redis/SQLite)             │
│  data/agent-commands.db                                      │
│  - Stores pending commands for each agent                   │
│  - Agent Monitor polls queue and injects to tmux            │
│  - Tracks command/response pairs                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Event Flow: User Clicks "Nudge"

### Current (Broken):
```
User clicks Nudge → Dashboard sends Enter to tmux → Nothing happens
```

### New (Interactive):
```
1. User clicks "Nudge" on agent card
   ↓
2. Dashboard → WebSocket: { action: 'nudge', session: 'system-improvements' }
   ↓
3. WebSocket Server → Agent Monitor: nudge(session)
   ↓
4. Agent Monitor captures recent output (last 50 lines)
   ↓
5. Agent Monitor → Telegram (Zoid): 
   "🤖 Agent 'system-improvements' needs attention
    Status: Stuck (idle 7 min)
    Last output: [50 lines of tmux capture]
    Options: [Send instruction] [Let it continue] [Kill]"
   ↓
6. Zoid analyzes output, decides action:
   Option A: "Agent is thinking, let it continue"
   Option B: "Agent needs input: 'Continue with implementation'"
   Option C: "Agent is stuck, needs different approach"
   ↓
7. Zoid's response → Agent Command Queue
   ↓
8. Agent Monitor picks up command → Injects to tmux
   ↓
9. Agent resumes work
   ↓
10. Dashboard shows: "✅ Zoid intervened: 'Continue with implementation'"
```

---

## Event Flow: Agent Gets Stuck

### Detection:
```
Agent Monitor detects:
- No tmux activity for 5+ minutes
- Same output hash for 3+ polls (frozen)
- Error patterns in output
- Waiting at prompt with no auto-approver activity
```

### Notification:
```
1. Agent Monitor → Telegram (Zoid):
   "⚠️ Agent 'relationship-os-impl' appears stuck
    Last activity: 5 minutes ago
    Output: [last 50 lines]
    Auto-approver: Running (PID 73238)
    Suggested action: Nudge or provide guidance?"
   ↓
2. Zoid analyzes situation
   ↓
3. Zoid responds with instruction or decision
   ↓
4. Dashboard updates in real-time:
   "🧠 Zoid is analyzing agent state..."
   "✅ Zoid: Sending instruction 'Check test output and fix errors'"
```

---

## Progress Tracking (Real)

### Current Problem:
- Dashboard shows 0% for all agents
- No actual progress tracking

### Solution: Parse Claude Code Output

**Progress Indicators:**
1. **Files changed**: Read/Write operations counted
2. **Tests passed**: Parse test output (`✓ 15/20 tests`)
3. **Milestones**: Detect completion phrases
   - "✅ Phase 1 complete"
   - "All tests passing"
   - "Ready for review"
4. **Thinking time**: Track contemplation duration

**Implementation:**
```javascript
function parseProgress(output, session) {
  const indicators = {
    filesRead: (output.match(/⏺ Read \d+ file/g) || []).length,
    filesWritten: (output.match(/⏺ Write\(/g) || []).length,
    filesEdited: (output.match(/⏺ Edit\(/g) || []).length,
    bashCommands: (output.match(/⏺ Bash\(/g) || []).length,
    contemplations: (output.match(/✻ Contemplating/g) || []).length,
    thinkingTime: extractThinkingTime(output), // "35s"
  };
  
  // Calculate progress based on task complexity
  const totalExpected = getExpectedTaskSize(session); // from task spec
  const completed = indicators.filesWritten + indicators.bashCommands;
  const progress = Math.min(100, (completed / totalExpected) * 100);
  
  return { progress, indicators };
}
```

**Progress Events:**
```javascript
// Agent Monitor emits progress events
monitor.on('progress', (session, data) => {
  broadcastToWebSocket({
    type: 'progress',
    session,
    progress: data.progress,
    indicators: data.indicators,
    timestamp: Date.now(),
  });
  
  updateDatabase(session, { progress: data.progress });
});
```

---

## Dashboard UI Updates

### Agent Card Enhancement

**Before:**
```
┌────────────────────────────────┐
│ 🧠 Router + Memory (P0)        │
│ Status: Stuck                  │
│ Last activity: 7 minutes ago   │
│ [View Logs] [Nudge] [Kill]     │
└────────────────────────────────┘
```

**After:**
```
┌────────────────────────────────────────────────────────────┐
│ 🧠 Router + Memory (P0)                     Status: Stuck  │
│ Session: system-improvements                7 min idle     │
├────────────────────────────────────────────────────────────┤
│ Progress: ▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 35%                        │
│ Files: Read 12, Written 3, Edited 1                        │
│ Contemplations: 5 (total: 2m 15s thinking)                 │
├────────────────────────────────────────────────────────────┤
│ 🧠 Zoid: "Agent is exploring codebase, let it continue"   │
│    ↳ Last check: 2 min ago                                 │
├────────────────────────────────────────────────────────────┤
│ [View Logs] [Ask Zoid to Intervene] [Send Instruction] [Kill] │
└────────────────────────────────────────────────────────────┘
```

### New: Conversation Panel

**Per-Agent Interaction History:**
```
┌────────────────────────────────────────────────────────────┐
│ 💬 Zoid ↔ system-improvements                              │
├────────────────────────────────────────────────────────────┤
│ 13:30 🤖 Agent started: "Reading SYSTEM_IMPROVEMENTS.md"   │
│ 13:32 🧠 Zoid: "Good, take your time exploring the code"  │
│ 13:35 ⚠️  Agent idle for 5 min                             │
│ 13:35 👤 User: [Nudge requested]                           │
│ 13:35 🧠 Zoid: "Agent is contemplating (35s), let it work" │
│ 13:38 🤖 Agent: "Started implementing router signals..."   │
│ 13:40 ✅ Zoid: "Looking good, continue"                    │
└────────────────────────────────────────────────────────────┘
```

### New: Send Instruction Input

**Interactive Command Panel:**
```html
<div class="agent-command-panel">
  <input type="text" placeholder="Send instruction to agent..." />
  <button>Send</button>
  
  <div class="quick-actions">
    <button>Continue</button>
    <button>Run tests</button>
    <button>Show progress</button>
    <button>Commit changes</button>
  </div>
</div>
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (2-3 hours)

**1.1 Agent Monitor Service**
```bash
packages/agent-monitor/
├── monitor.js           # Main monitoring loop
├── state-detector.js    # Detect agent states from output
├── progress-parser.js   # Parse Claude Code output for progress
└── tmux-watcher.js      # Watch tmux sessions in real-time
```

**1.2 WebSocket Server**
```bash
packages/dashboard/
├── websocket-server.js  # WebSocket server for real-time events
└── server.js            # Extend with WebSocket integration
```

**1.3 Data Storage**
```bash
data/
├── agent-state.db       # SQLite: current state of all agents
├── agent-commands.db    # SQLite: command queue
└── interaction-log.db   # SQLite: Zoid ↔ Agent conversation history
```

### Phase 2: Zoid Integration (1-2 hours)

**2.1 Clawdbot Extension**
```bash
~/.clawdbot/extensions/agent-interaction/
├── index.js             # Main hook
├── event-handler.js     # Receives agent events
└── decision-engine.js   # Zoid's analysis logic
```

**2.2 Event Routing**
- Agent Monitor → `clawdbot gateway wake` with event payload
- Zoid receives event, analyzes, responds
- Response → Agent Command Queue
- Agent Monitor picks up command → Executes

### Phase 3: Dashboard UI (2 hours)

**3.1 WebSocket Client**
```javascript
// packages/dashboard/public/index.html
const ws = new WebSocket('ws://localhost:3847');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'agent_state':
      updateAgentCard(data.session, data.state);
      break;
    case 'progress':
      updateProgressBar(data.session, data.progress);
      break;
    case 'zoid_message':
      addToConversation(data.session, 'zoid', data.message);
      break;
    case 'agent_output':
      addToConversation(data.session, 'agent', data.output);
      break;
  }
};
```

**3.2 Interactive Controls**
- Nudge → Sends event to Zoid for analysis
- Send Instruction → Directly adds to command queue
- View Logs → Real-time stream via WebSocket
- Conversation panel → Shows Zoid ↔ Agent interaction

### Phase 4: Progress Tracking (1 hour)

**4.1 Progress Parser**
```javascript
// Analyze Claude Code output patterns
const progressPatterns = {
  fileRead: /⏺ Read (\d+) files?/,
  fileWrite: /⏺ Write\(([^)]+)\)/,
  fileEdit: /⏺ Edit\(([^)]+)\)/,
  bashCmd: /⏺ Bash\(([^)]+)\)/,
  thinking: /✻ Contemplating… \((\d+)s/,
  testPass: /✓ (\d+)\/(\d+) tests/,
  milestone: /✅ (Phase \d+|Complete|Ready|Done)/,
};
```

**4.2 Task Size Estimation**
- Parse task spec for expected deliverables
- Track completion ratio
- Estimate time remaining based on thinking patterns

---

## Technical Details

### Agent State Machine

```javascript
const AgentState = {
  INITIALIZING: 'initializing',    // Just started
  READING: 'reading',               // Reading files
  THINKING: 'thinking',             // Contemplating (extended)
  WORKING: 'working',               // Writing/editing files
  TESTING: 'testing',               // Running tests
  IDLE: 'idle',                     // At prompt, waiting
  STUCK: 'stuck',                   // Idle too long
  ERROR: 'error',                   // Error detected
  COMPLETE: 'complete',             // Task finished
};

function detectState(output, lastState, idleTime) {
  if (output.includes('✻ Contemplating')) return AgentState.THINKING;
  if (output.includes('⏺ Read')) return AgentState.READING;
  if (output.includes('⏺ Write') || output.includes('⏺ Edit')) return AgentState.WORKING;
  if (output.includes('⏺ Bash') && output.includes('test')) return AgentState.TESTING;
  if (output.includes('✅') && output.includes('complete')) return AgentState.COMPLETE;
  if (output.endsWith('❯ \n') && idleTime > 300) return AgentState.STUCK;
  if (output.endsWith('❯ \n')) return AgentState.IDLE;
  if (output.includes('Error:') || output.includes('✗')) return AgentState.ERROR;
  
  return lastState;
}
```

### Tmux Monitoring

**Option 1: Tmux Control Mode** (preferred)
```bash
tmux -C attach -t system-improvements
```
- Real-time event stream
- No polling lag
- Requires persistent process per session

**Option 2: High-Frequency Polling** (fallback)
```javascript
setInterval(() => {
  sessions.forEach(async (session) => {
    const output = await captureTmuxPane(session);
    const hash = crypto.createHash('md5').update(output).digest('hex');
    
    if (hash !== lastHash[session]) {
      // Output changed, analyze state
      const state = detectState(output, currentState[session], 0);
      emitEvent('state_change', { session, state, output });
      lastHash[session] = hash;
      lastActivity[session] = Date.now();
    } else {
      // No change, check idle time
      const idleTime = (Date.now() - lastActivity[session]) / 1000;
      if (idleTime > 300 && currentState[session] !== AgentState.STUCK) {
        currentState[session] = AgentState.STUCK;
        emitEvent('agent_stuck', { session, idleTime, output });
      }
    }
  });
}, 5000); // Poll every 5 seconds
```

### Command Injection

```javascript
async function sendCommandToAgent(session, command) {
  // Add to command queue
  await db.run(
    'INSERT INTO agent_commands (session, command, timestamp, status) VALUES (?, ?, ?, ?)',
    [session, command, Date.now(), 'pending']
  );
  
  // Agent Monitor picks it up
  // Injects to tmux
  execFile('tmux', ['send-keys', '-t', session, command, 'Enter']);
  
  // Mark as sent
  await db.run(
    'UPDATE agent_commands SET status = ? WHERE session = ? AND command = ?',
    ['sent', session, command]
  );
  
  // Emit event
  emitEvent('command_sent', { session, command });
}
```

---

## Data Models

### agent_state.db (SQLite)

```sql
CREATE TABLE agent_state (
  session TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  last_activity INTEGER,
  last_output TEXT,
  files_read INTEGER DEFAULT 0,
  files_written INTEGER DEFAULT 0,
  contemplation_time INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0
);

CREATE TABLE interaction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor TEXT NOT NULL, -- 'zoid', 'user', 'agent'
  action TEXT NOT NULL, -- 'nudge', 'command', 'message', 'state_change'
  content TEXT,
  metadata TEXT -- JSON
);
```

### agent_commands.db (SQLite)

```sql
CREATE TABLE commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,
  command TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'executed', 'failed'
  source TEXT, -- 'zoid', 'user', 'auto'
  response TEXT
);
```

---

## Success Metrics

### Before:
- ❌ Dashboard updates every 5 seconds (polling)
- ❌ Nudge just sends Enter (blind)
- ❌ No Zoid involvement in agent management
- ❌ Progress shows 0%
- ❌ No way to know if agent needs help

### After:
- ✅ Real-time updates via WebSocket (< 1s latency)
- ✅ Nudge triggers Zoid analysis with context
- ✅ Zoid can intervene, provide guidance, or let agent continue
- ✅ Progress tracked via output parsing (files, tests, milestones)
- ✅ Bi-directional conversation between Zoid and agents
- ✅ Interactive command panel for sending instructions
- ✅ Dashboard shows Zoid's decisions and agent responses

---

## Next Steps

1. Implement Agent Monitor Service (monitor.js, state-detector.js)
2. Add WebSocket server to dashboard (websocket-server.js)
3. Create Clawdbot extension for agent events (agent-interaction/)
4. Update dashboard UI with WebSocket client and interactive controls
5. Implement progress parsing and tracking
6. Test end-to-end flow: Nudge → Zoid analysis → Command injection
7. Deploy and monitor

**Estimated time:** 6-8 hours for full implementation

**Owner:** Zoid (me)  
**Priority:** P0 — required for effective agent orchestration
