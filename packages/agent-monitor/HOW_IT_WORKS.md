# How Status & Progress Are Derived

**Location:** `packages/agent-monitor/monitor-v2.js`

---

## Status Detection

**Status is derived from Claude Code output patterns.**

### How It Works

Every time the agent outputs text, the monitor:
1. Captures tmux pane output (last 100 lines)
2. Scans for specific Claude Code symbols
3. Sets state based on what's found

### State Detection Logic

```javascript
detectState(output, lastState, idleTime) {
  // THINKING - Agent is contemplating
  if (output.includes('✻ Contemplating') || output.includes('✶ Contemplating')) {
    return 'thinking';
  }
  
  // READING - Only reading, no writing
  if (output.includes('⏺ Read') && !output.includes('⏺ Write')) {
    return 'reading';
  }
  
  // WORKING - Writing or editing files
  if (output.includes('⏺ Write') || output.includes('⏺ Edit')) {
    return 'working';
  }
  
  // TESTING - Running tests
  if (output.includes('⏺ Bash') && output.includes('test')) {
    return 'testing';
  }
  
  // COMPLETE - Task finished
  if ((output.includes('✅') && output.includes('complete')) || 
      output.includes('Task complete')) {
    return 'complete';
  }
  
  // ERROR - Error detected
  if (output.includes('Error:') || output.includes('✗') || 
      output.includes('[ERROR]')) {
    return 'error';
  }
  
  // STUCK - At prompt with no activity for 5+ minutes
  if (output.trim().endsWith('❯') && idleTime > 300) {
    return 'stuck';
  }
  
  // IDLE - At prompt, recently active
  if (output.trim().endsWith('❯')) {
    return 'idle';
  }
  
  // Keep previous state if no match
  return lastState || 'idle';
}
```

### Example: What You See

**Agent output:**
```
⏺ Read 3 files (ctrl+o to expand)
✻ Contemplating… (45s · ↓ 2.1k tokens)
⏺ Write(packages/api/server.js)
⏺ Edit(README.md)
✅ Task complete
```

**Detected states (in order):**
1. `reading` (⏺ Read detected)
2. `thinking` (✻ Contemplating detected)
3. `working` (⏺ Write/Edit detected)
4. `complete` (✅ Task complete detected)

---

## Progress Calculation

**Progress uses TWO methods** (task spec preferred, output fallback).

### Method 1: Task Spec Parsing (Preferred)

**Looks for markdown checkbox tasks** in related files.

#### How It Works

1. **Find spec file** for session
   - Looks in current working directory
   - Searches for: `SYSTEM_IMPROVEMENTS.md`, `README.md`, `TODO.md`, `TASKS.md`
   - Matches filename patterns related to session name

2. **Parse checkboxes**
   ```markdown
   ## Tasks
   - [x] Fix tmux control mode
   - [x] Add progress tracking
   - [ ] Add WebSocket server
   - [ ] Write tests
   ```
   
3. **Calculate progress**
   ```javascript
   total = 4  // Total checkboxes
   completed = 2  // Checked boxes [x]
   progress = (2 / 4) * 100 = 50%
   ```

#### Example: system-improvements

**File:** `SYSTEM_IMPROVEMENTS.md`
```markdown
## Tasks
- [x] Router signal detection        ← DONE
- [x] Memory tracker                  ← DONE
- [x] Dashboard panels                ← DONE
- [x] Alert system                    ← DONE
- [ ] Testing                         ← TODO
```

**Result:** `progress = 80%` (4/5 complete)

---

### Method 2: Output Heuristics (Fallback)

**When no task spec exists**, estimate from Claude Code output.

#### Indicators Counted

```javascript
parseProgress(output) {
  const indicators = {
    filesWritten: count('⏺ Write('),      // Files created
    filesEdited: count('⏺ Edit('),        // Files modified
    filesRead: count('⏺ Read'),           // Files opened
    bashCommands: count('⏺ Bash('),       // Commands run
    contemplations: count('✻ Contemplating'),  // Thinking sessions
    thinkingTime: extractThinkingTime(output), // Total seconds
    errors: count('Error:|✗|[ERROR]')     // Errors encountered
  };
  
  // Simple heuristic: completed = files written + commands run
  const completed = indicators.filesWritten + 
                    indicators.filesEdited + 
                    indicators.bashCommands;
  
  // Estimate total (default: 10, or session-specific)
  let estimated = 10;
  if (session.includes('impl') || session.includes('backend')) {
    estimated = 20;  // Bigger projects
  }
  
  progress = Math.min(100, (completed / estimated) * 100);
}
```

#### Example: relationship-os-ios

**Output:**
```
⏺ Read 2 files
⏺ Bash(pwd)
```

**Calculation:**
```javascript
filesWritten: 0
filesRead: 2
bashCommands: 1
completed = 0 + 0 + 1 = 1
estimated = 10
progress = (1 / 10) * 100 = 10%  // Matches your screenshot!
```

---

## Stats (Written/Read/Thinking)

**These come directly from output parsing.**

### How They're Counted

```javascript
// Written files
filesWritten = count('⏺ Write(')
// Example: "⏺ Write(server.js)" → count++

// Read files  
filesRead = count('⏺ Read')
// Example: "⏺ Read 3 files" → count++

// Thinking time
thinkingTime = extractThinkingTime(output)
// Example: "Contemplating… (45s)" → extract 45, sum all
```

### Example From Your Screenshot

**relationship-os-ios:**
- **Written:** 0 (no `⏺ Write(` found)
- **Read:** 3 (found `⏺ Read` 3 times)
- **Thinking:** 0s (no `Contemplating… (Xs)` found)

**system-improvements:**
- **Progress:** 80% (from SYSTEM_IMPROVEMENTS.md: 4/5 tasks checked)
- **Status:** STUCK (idle >5 minutes)

---

## Real-Time Updates

### How Updates Flow

```
1. Agent outputs text in tmux
   ↓
2. Tmux control mode detects change (hybrid polling)
   ↓
3. Monitor captures last 100 lines
   ↓
4. detectState() scans for symbols
   ↓
5. parseProgress() counts indicators OR parses task spec
   ↓
6. State/progress saved to SQLite
   ↓
7. Event published to Redis
   ↓
8. WebSocket broadcasts to dashboard
   ↓
9. Your browser updates UI instantly
```

**Latency:** < 1 second (hybrid polling checks every 5s, but state changes trigger immediate events)

---

## Why This Works

### Reliable Indicators

**Claude Code always outputs the same symbols:**
- ✻ Contemplating → Thinking
- ⏺ Read → Reading files
- ⏺ Write → Creating files
- ⏺ Edit → Modifying files
- ⏺ Bash → Running commands
- ✅ → Task complete
- ❯ → At prompt (idle)

**These are consistent across all Claude Code versions.**

### Task Spec Benefits

**When task specs exist (markdown files with checkboxes):**
- **Accurate progress** - Not estimated, actual task completion
- **User-defined** - You control what counts as progress
- **Transparent** - Can see exactly what's done vs todo
- **Cacheable** - Updated every 30s, not every output line

### Fallback Robustness

**When no task spec:**
- Still provides **rough progress estimate**
- Counts **concrete actions** (files written, commands run)
- Better than nothing!

---

## Configuration

### Stuck Threshold

```javascript
const STUCK_THRESHOLD = 300; // 5 minutes
```

**Change in:** `packages/agent-monitor/monitor-v2.js` line 38

### Polling Interval

```javascript
// Hybrid polling checks every 5 seconds
setInterval(pollTmux, 5000);
```

**Change in:** `packages/agent-monitor/tmux-control.js`

### Task Spec Cache TTL

```javascript
// Cache task spec for 30 seconds
if (cached && (now - cached.lastUpdated) < 30000) {
  return cached;
}
```

**Change in:** `packages/agent-monitor/monitor-v2.js` line 177

---

## Debugging

### See What The Monitor Sees

```bash
# View raw tmux output
tmux capture-pane -t relationship-os-ios -p -S -100

# Check detected state
curl http://localhost:3848/api/agents/relationship-os-ios | jq '{state,progress,indicators}'

# Watch real-time events
node -e "
const ws = new (require('ws'))('ws://localhost:3848');
ws.on('message', d => console.log(d.toString()));
"

# Check database
sqlite3 ~/Projects/localllm-hub/data/agent-state.db "SELECT session, state, progress FROM agent_state;"
```

### Verify Task Spec Detection

```bash
# Check if spec file was found
curl http://localhost:3848/api/agents/system-improvements | jq '.indicators.taskSpecFile'

# Expected: "SYSTEM_IMPROVEMENTS.md" or null if not found
```

---

## Summary

**Status:** Derived from Claude Code output symbols (✻⏺✅❯)

**Progress:**
1. **Preferred:** Parse markdown checkboxes from task spec files
2. **Fallback:** Count files written + commands run / estimated total

**Stats:** Direct count of output symbols

**Updates:** Real-time via WebSocket (< 1s latency)

**Storage:** SQLite (persists across restarts)

**Caching:** Task specs cached 30s, agent state updated on every output change

---

**The system watches Claude Code's own output and translates it into structured state/progress data.** No custom instrumentation needed - it just reads what Claude Code naturally outputs! 🦑
