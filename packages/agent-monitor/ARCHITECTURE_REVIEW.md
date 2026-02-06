# Agent Monitor Phase 1: Architecture Review

**Date:** 2026-02-05  
**Status:** 90% Complete (API routing issue, tmux control mode needs refinement)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER/DASHBOARD                           │
│  - HTTP REST API (port 3848)                                    │
│  - WebSocket (for real-time events)                             │
└────────────────┬────────────────────────────────────────────────┘
                 │ HTTP/WS
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                      API SERVER                                  │
│  packages/agent-monitor/api-server.js                           │
│  - Express HTTP server                                          │
│  - Exposes agent state, commands, logs                          │
│  - CORS enabled for dashboard                                   │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                   AGENT MONITOR (Core)                           │
│  packages/agent-monitor/monitor-v2.js                           │
│  - Manages tmux control sessions                                │
│  - Detects agent states (reading, thinking, working, etc.)      │
│  - Tracks progress (files changed, tests run, etc.)             │
│  - Publishes events to EventBus                                 │
│  - Stores state in SQLite                                       │
└─────┬──────────────────────────────────┬────────────────────────┘
      │                                  │
      ↓ Control                          ↓ Events
┌─────────────────┐              ┌─────────────────────────────────┐
│  TMUX SESSIONS  │              │         EVENT BUS               │
│  - impl         │              │  packages/agent-monitor/        │
│  - ios          │              │  event-bus.js                   │
│  - backend      │              │  - Redis pub/sub                │
│  - improvements │              │  - BullMQ queues                │
└─────────────────┘              │  - Decoupled messaging          │
                                 └────────┬────────────────────────┘
                                          │
                                          ↓ Subscribe
                                 ┌────────────────────────────────┐
                                 │   COMMAND QUEUE PROCESSOR      │
                                 │  packages/agent-monitor/       │
                                 │  command-queue.js              │
                                 │  - BullMQ worker               │
                                 │  - Persistent queue (SQLite)   │
                                 │  - Retry logic                 │
                                 │  - Sends commands to tmux      │
                                 └────────────────────────────────┘
```

---

## Component Breakdown

### 1. **daemon.js** - Main Orchestrator

**Purpose:** Bootstraps and coordinates all components.

**What it does:**
1. Creates EventBus (Redis connection)
2. Creates AgentMonitor (tmux control mode)
3. Creates CommandQueueProcessor (BullMQ worker)
4. Starts API Server (Express)
5. Connects to target tmux sessions
6. Subscribes to events and logs them

**Key code:**
```javascript
// Initialize all components
this.eventBus = new EventBus(REDIS_URL);
this.monitor = new AgentMonitorV2(this.eventBus);
this.commandQueue = new CommandQueueProcessor(this.monitor, this.eventBus);
this.apiServer = new APIServer(this.monitor, this.eventBus, this.commandQueue);

// Start everything
await this.apiServer.start();
this.commandQueue.start();
await this.monitor.start(targetSessions);
```

**Dependencies:**
- Redis (must be running)
- Tmux sessions (must exist)
- Node.js 20+

**Entry point:** `node packages/agent-monitor/daemon.js`

---

### 2. **event-bus.js** - Decoupled Messaging

**Purpose:** Redis-based event publishing for decoupling components.

**Why Redis?**
- **Pub/Sub:** Real-time event broadcasting (WebSocket can subscribe)
- **BullMQ Queues:** Persistent job queue with retry logic
- **Decoupling:** Clawdbot extension can subscribe without tight coupling

**Key APIs:**
```javascript
// Publish event
await eventBus.publishEvent('agent_stuck', {
  session: 'system-improvements',
  idleTime: 300,
  output: '...'
});

// Enqueue command
const jobId = await eventBus.enqueueCommand(
  'system-improvements',
  'Continue with implementation',
  'zoid'
);

// Subscribe to events (for WebSocket broadcast)
await eventBus.subscribe((event) => {
  wss.broadcast(event);
});
```

**Data flow:**
1. Monitor detects state change → `publishEvent('state_change', {...})`
2. Event goes to Redis pub/sub (instant broadcast)
3. Event also goes to BullMQ queue (persistent log)
4. WebSocket server subscribes → broadcasts to dashboard
5. Clawdbot extension subscribes → notifies Zoid

**Why BullMQ?**
- **Persistent:** Events survive restarts
- **Retry:** Failed notifications can retry
- **History:** Can query recent events
- **Rate limiting:** Built-in (10 commands/sec)

**Trade-offs:**
- ✅ Decoupled (dashboard/Clawdbot independent)
- ✅ Reliable (persistent queue)
- ✅ Scalable (multiple consumers)
- ❌ Requires Redis (extra dependency)
- ❌ More complex than direct calls

---

### 3. **monitor-v2.js** - Core Agent Monitoring

**Purpose:** Connects to tmux sessions via control mode, detects state changes, tracks progress.

**Key concepts:**

#### State Machine
```javascript
const AgentState = {
  INITIALIZING: 'initializing',  // Just connected
  READING: 'reading',             // ⏺ Read files
  THINKING: 'thinking',           // ✻ Contemplating
  WORKING: 'working',             // ⏺ Write/Edit
  TESTING: 'testing',             // ⏺ Bash test
  IDLE: 'idle',                   // At ❯ prompt
  STUCK: 'stuck',                 // Idle >5min
  ERROR: 'error',                 // Error detected
  COMPLETE: 'complete',           // Task done
};
```

#### State Detection (Regex-based)
```javascript
detectState(output, lastState, idleTime) {
  if (output.includes('✻ Contemplating')) return AgentState.THINKING;
  if (output.includes('⏺ Write')) return AgentState.WORKING;
  // ... etc
}
```

**Trade-off discussion:**
- ✅ Simple, works now
- ❌ Fragile (depends on Claude Code output format)
- 🔄 Future: Could use LLM-based classification or Claude Code API

#### Progress Tracking
```javascript
parseProgress(output) {
  const indicators = {
    filesWritten: (output.match(/⏺ Write\(/g) || []).length,
    bashCommands: (output.match(/⏺ Bash\(/g) || []).length,
    thinkingTime: extractThinkingTime(output),
  };
  
  const progress = Math.min(100, (completed / estimated) * 100);
  return { progress, indicators };
}
```

**Issue:** `estimated` is hardcoded (10). Should come from task spec.

**Future:** Parse SYSTEM_IMPROVEMENTS.md for expected deliverables, track completion.

#### Database Schema
```sql
-- Agent state (current snapshot)
CREATE TABLE agent_state (
  session TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  progress INTEGER,
  last_activity INTEGER,
  last_output TEXT,
  files_read INTEGER,
  files_written INTEGER,
  -- ...
);

-- Interaction log (audit trail)
CREATE TABLE interaction_log (
  id INTEGER PRIMARY KEY,
  session TEXT,
  timestamp INTEGER,
  actor TEXT,  -- 'user', 'zoid', 'system'
  action TEXT, -- 'nudge', 'command', 'state_change'
  content TEXT,
  metadata TEXT -- JSON
);
```

**Why SQLite?**
- ✅ Simple (no server)
- ✅ Fast (local)
- ✅ Persistent (survives restarts)
- ✅ Good enough for 50+ agents
- ❌ Can't scale across machines (but we don't need that yet)

---

### 4. **tmux-control.js** - Real-Time Tmux Integration

**Purpose:** Connect to tmux sessions using control mode for real-time event streaming (no polling).

**How tmux control mode works:**
```bash
tmux -C attach -t session-name
# Outputs:
# %output %0 <base64-data>
# %session-changed $0 session-name
# %window-add @0
# ...
```

**Our implementation:**
```javascript
class TmuxControlSession extends EventEmitter {
  async connect() {
    this.proc = spawn('tmux', ['-C', 'attach', '-t', this.sessionName]);
    
    this.proc.stdout.on('data', (data) => {
      // Parse control protocol
      if (data.startsWith('%output')) {
        const content = decodeBase64(data);
        this.emit('output', content);
      }
    });
  }
  
  async sendKeys(keys) {
    this.proc.stdin.write(`send-keys -t ${this.sessionName} ${keys} Enter\n`);
  }
}
```

**Current issue:**
- ✅ Connects successfully
- ❌ **Exits immediately** with code 0
- 🔧 **Root cause:** Control mode `attach` doesn't stay connected like we need

**Why it exits:**
Tmux control mode `attach` is designed for automation, not persistent monitoring. When there's no TTY, it connects, sends initial output, then exits.

**Solution (need to implement):**
```javascript
// Option A: Use `attach -r` (read-only, stay attached)
spawn('tmux', ['-C', 'attach', '-r', '-t', session]);

// Option B: Don't use attach, use control commands
const proc = spawn('tmux', ['-C', 'new-session', '-A', '-s', 'monitor']);
proc.stdin.write(`capture-pane -t ${session} -p\n`);
// Send periodic capture commands

// Option C: Hybrid - control mode for commands, polling for output
// (Most reliable for our use case)
```

**My recommendation:** Option C (hybrid approach)
- Use control mode for sending commands (instant)
- Use periodic capture for reading output (reliable)
- Best of both worlds

---

### 5. **command-queue.js** - Persistent Command Queue

**Purpose:** Reliable command execution with retry logic and audit trail.

**Why a queue?**
- **Reliability:** Commands aren't lost if tmux dies
- **Retry:** Failed commands retry automatically (BullMQ)
- **Audit:** Full command history in SQLite
- **Rate limiting:** Prevent overwhelming agents

**Flow:**
```
1. User clicks "Send Command" in dashboard
   ↓
2. Dashboard → API: POST /api/agents/:session/command
   ↓
3. API → EventBus.enqueueCommand()
   ↓
4. EventBus → BullMQ (persistent queue)
   ↓
5. CommandQueueProcessor (worker) picks up job
   ↓
6. Worker → tmux send-keys
   ↓
7. Update SQLite: status = 'sent'
   ↓
8. Publish event: command_sent
```

**BullMQ worker config:**
```javascript
new Worker('agent-commands', processCommand, {
  connection: redis,
  concurrency: 5,      // Process 5 commands at once
  limiter: {
    max: 10,           // Max 10 commands
    duration: 1000,    // Per second
  },
  attempts: 3,         // Retry 3 times
  backoff: {
    type: 'exponential',
    delay: 2000,       // 2s, 4s, 8s
  },
});
```

**Database tracking:**
```sql
INSERT INTO commands (id, session, command, status, created_at)
VALUES ('job-123', 'system-improvements', 'Continue', 'pending', 1234567890);

-- After sending:
UPDATE commands SET status = 'sent', sent_at = 1234567900 WHERE id = 'job-123';

-- If failed:
UPDATE commands SET status = 'failed', error = 'Session not found' WHERE id = 'job-123';
```

**Why this matters:**
- You can query command history
- You can see retry attempts
- You can debug failures
- Full audit trail for compliance

---

### 6. **api-server.js** - HTTP REST API

**Purpose:** Expose agent data and control to dashboard (and Zoid).

**Endpoints:**

```javascript
// Health check
GET /health
→ { status: 'ok', timestamp: 1234567890 }

// List all agents
GET /api/agents
→ { agents: [...], count: 4 }

// Get single agent
GET /api/agents/:session
→ { session, state, progress, indicators, ... }

// Get agent output
GET /api/agents/:session/output?lines=100
→ { session, output, lines: 100 }

// Send command
POST /api/agents/:session/command
Body: { command: "Continue with implementation", source: "zoid" }
→ { jobId, status: 'queued' }

// Get command history
GET /api/agents/:session/commands?limit=50
→ { commands: [...], count: 50 }

// Get interaction log
GET /api/agents/:session/log?limit=50
→ { log: [...], count: 50 }

// Kill session
POST /api/agents/:session/kill
→ { success: true }

// Statistics
GET /api/stats
→ { agents: { total, byState }, commands: { pending }, uptime }
```

**Current issue:** Routes not responding (404 HTML instead of JSON)

**Likely cause:**
```javascript
// api-server.js
this.app = express();
this.setupMiddleware();
this.setupRoutes();      // Routes are defined
await this.apiServer.start();  // Server starts

// But Express might not be seeing the routes
```

**Debug needed:** Check if routes are actually registered.

**My guess:** The issue is in how the server is started in daemon.js. The APIServer class looks correct, but there might be a timing issue or the app instance isn't properly initialized.

---

## Data Flow Examples

### Example 1: Agent Gets Stuck

```
1. Agent idle for 5+ minutes
   ↓
2. Monitor.checkStuckSessions() detects it
   ↓
3. Monitor → EventBus.publishEvent('agent_stuck', {
     session: 'system-improvements',
     idleTime: 320,
     output: '...'
   })
   ↓
4. EventBus → Redis pub/sub (instant)
   ↓
5. EventBus → BullMQ queue (persistent)
   ↓
6. WebSocket server (subscribed to Redis) → broadcasts to dashboard
   ↓
7. Dashboard updates UI: "🤖 Agent stuck (idle 5m 20s)"
   ↓
8. Clawdbot extension (subscribed to BullMQ) → picks up job
   ↓
9. Clawdbot → Telegram: "⚠️ Agent stuck, what should I do?"
   ↓
10. Zoid analyzes, responds: "Send 'Continue with implementation'"
   ↓
11. Zoid → EventBus.enqueueCommand('system-improvements', 'Continue')
   ↓
12. CommandQueueProcessor picks up job → sends to tmux
   ↓
13. Agent resumes work
```

### Example 2: User Clicks "Nudge"

```
1. User clicks Nudge button in dashboard
   ↓
2. Dashboard → API: POST /api/agents/system-improvements/command
   Body: { command: "", source: "nudge" }
   ↓
3. API → EventBus.enqueueCommand()
   ↓
4. API → Monitor.logInteraction('user', 'nudge', ...)
   ↓
5. API → EventBus.publishEvent('nudge_requested', {
     session,
     state,
     output,
     idleTime
   })
   ↓
6. Clawdbot extension receives event → notifies Zoid
   ↓
7. Zoid analyzes output, decides action
   ↓
8. Zoid → EventBus.enqueueCommand() with actual command
   ↓
9. CommandQueueProcessor sends to tmux
   ↓
10. Dashboard shows: "🧠 Zoid: Sending instruction..."
```

---

## Key Design Decisions (Review)

### Decision 1: Why Control Mode?
**Choice:** Tmux control mode (no polling)

**Pros:**
- Real-time (< 1s latency)
- No wasted CPU on polling
- Scalable (1 persistent connection vs 12 processes/min)

**Cons:**
- More complex implementation
- Tmux control mode quirks (exits immediately)

**Status:** Needs refinement (current implementation exits)

---

### Decision 2: Why Redis/BullMQ?
**Choice:** Redis pub/sub + BullMQ queues

**Pros:**
- Decoupled (Clawdbot can subscribe independently)
- Persistent (events/commands survive restarts)
- Reliable (automatic retries)
- Scalable (multiple consumers)

**Cons:**
- Extra dependency (Redis)
- More complex than direct calls
- Requires Redis to be running

**Alternatives considered:**
- Direct HTTP calls: Faster but tightly coupled
- Unix sockets: Fast but less flexible
- No queue: Simpler but commands can be lost

**Verdict:** Worth the complexity for decoupling + reliability.

---

### Decision 3: Why SQLite?
**Choice:** SQLite for state + command history

**Pros:**
- Simple (no server)
- Fast (local)
- Persistent (survives restarts)
- Good enough for 100+ agents

**Cons:**
- Can't scale across machines
- Manual management (no admin UI)

**Alternatives considered:**
- Redis only: Faster but less structured
- PostgreSQL: Overkill for local service

**Verdict:** SQLite is perfect for this use case.

---

### Decision 4: Why Standalone Service?
**Choice:** Separate daemon (not embedded in dashboard)

**Pros:**
- Dashboard can restart without losing monitoring
- Can run on different machine (future)
- Clean separation of concerns
- Multiple dashboards can connect

**Cons:**
- Extra process to manage
- Need IPC/HTTP between components

**Verdict:** Worth it for decoupling and reliability.

---

## Files Summary

```
packages/agent-monitor/
├── daemon.js              (4.9KB) - Main orchestrator
├── monitor-v2.js          (11.8KB) - Core monitoring logic
├── tmux-control.js        (4.4KB) - Tmux control mode
├── event-bus.js           (4.1KB) - Redis/BullMQ integration
├── command-queue.js       (5.4KB) - Persistent command queue
├── api-server.js          (7.0KB) - HTTP REST API
└── ARCHITECTURE_REVIEW.md (this file)

Total: ~38KB of new code
```

---

## Issues to Fix (Phase 1.1)

### Issue 1: API Routes Not Responding ⚠️
**Symptom:** GET /health returns 404 HTML instead of JSON

**Likely cause:** Express routing not properly initialized

**Fix:** Debug Express app initialization in daemon.js

---

### Issue 2: Tmux Control Mode Exits Immediately ⚠️
**Symptom:** Sessions connect but immediately exit with code 0

**Root cause:** Control mode `attach` doesn't stay connected without TTY

**Fix:** Hybrid approach - control mode for commands, periodic capture for output

---

### Issue 3: Progress Estimation Hardcoded ⚠️
**Symptom:** Progress is (completed / 10) * 100, where 10 is arbitrary

**Fix:** Parse task spec for expected deliverables

---

## Next Steps (Your Call)

1. **Fix API routing** (30 min) - Get endpoints responding
2. **Refactor tmux control** (1 hour) - Hybrid approach for reliable output
3. **Test end-to-end** (30 min) - Verify full event flow
4. **Add deployment scripts** (1 hour) - PM2 + systemd/launchd options

**Should I proceed with fixes now, or do you have questions about the architecture?** 🦑
