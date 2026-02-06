# Autonomous Agent System Design

**Status:** DORMANT - Code exists but not activated  
**Activation:** Requires explicit user command

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Consciousness Loop                     │
│  (Background daemon, runs continuously)                  │
└────────────┬────────────────────────────────────────────┘
             │
             ├─► Observation Layer (reads environment)
             │   - Email monitoring (gog CLI)
             │   - Calendar sync
             │   - Git status
             │   - System events
             │   - File changes
             │
             ├─► Reasoning Layer (decides what to do)
             │   - Tier 1: Local Qwen (free, fast)
             │   - Tier 2: Haiku (cheap, quick)
             │   - Tier 3: Sonnet/Opus (expensive, deep)
             │
             ├─► Action Layer (executes safely)
             │   - Whitelist enforcement
             │   - Rate limiting
             │   - Dry-run mode
             │   - Audit logging
             │
             └─► Memory Layer (persistent state)
                 - Working memory (hot state)
                 - Thought logs
                 - Action history
                 - Learning updates
```

## Core Components

### 1. Observation Service (`observation.js`)
Monitors environment for changes. Outputs structured events.

**Inputs:**
- Email (via gog CLI)
- Calendar (via gog CLI)
- Git repos (via git status)
- File system (via chokidar)
- System state (ps, network)

**Outputs:**
```json
{
  "timestamp": "2026-02-03T06:30:00Z",
  "events": [
    {
      "type": "email",
      "priority": "high",
      "data": {...}
    },
    {
      "type": "calendar",
      "priority": "medium",
      "data": {...}
    }
  ]
}
```

### 2. Reasoning Service (`reasoning.js`)
Tiered decision-making with cost optimization.

**Flow:**
1. Tier 1 (Qwen local): "Is this important?" → yes/no
2. Tier 2 (Haiku): "What action?" → alert | ignore | escalate
3. Tier 3 (Sonnet/Opus): Complex reasoning only when needed

**Cost optimization:**
- 95% of cycles use Tier 1 (free)
- 4% use Tier 2 ($0.01/call)
- 1% use Tier 3 ($1/call)
- Target: $20/day average

### 3. Action Service (`action.js`)
Executes decisions with safety controls.

**Whitelist (safe by default):**
```javascript
const SAFE_ACTIONS = {
  'alert': { risk: 'low', rate_limit: 5/hour },
  'organize_files': { risk: 'low', rate_limit: 10/hour },
  'commit_memory': { risk: 'low', rate_limit: 20/hour },
  'update_docs': { risk: 'low', rate_limit: 5/hour }
};

const FORBIDDEN_ACTIONS = [
  'delete_important',
  'send_message_to_human',
  'spend_money',
  'modify_code'
];
```

**Safety mechanisms:**
- Dry-run mode (log what WOULD happen)
- Action deduplication (don't repeat within 1hr)
- Circuit breaker (stop after 3 failures)
- Audit log (every action recorded)

### 4. Memory Service (`memory.js`)
Persistent working memory across cycles.

**Schema:**
```javascript
{
  working_memory: {
    current_focus: "string",
    active_tasks: [],
    recent_observations: [],
    pending_actions: []
  },
  thought_log: [
    { time, cycle, reasoning, decision }
  ],
  action_history: [
    { time, action, result, cost }
  ]
}
```

**Storage:**
- SQLite for structured data
- JSON files for thought logs
- Checkpointing every 5 minutes

### 5. Control Service (`control.js`)
Start/stop/pause the agent safely.

**Commands:**
```bash
# Status
node cli.js agent status

# Start (dry-run first)
node cli.js agent start --dry-run
node cli.js agent start --live

# Pause (stop acting, keep monitoring)
node cli.js agent pause

# Stop (graceful shutdown)
node cli.js agent stop

# Emergency kill
node cli.js agent kill
```

**Health checks:**
- Heartbeat every 60s
- Resource monitoring (CPU/memory)
- Cost tracking (API spend)
- Error rate monitoring

## Safety Features

### Rate Limiting
```javascript
const LIMITS = {
  api_calls: { max: 200/day },
  actions: { max: 50/day },
  alerts: { max: 10/hour },
  cost: { max: 30/day }  // Kill switch at $30/day
};
```

### Circuit Breakers
```javascript
if (consecutive_failures > 3) {
  agent.pause();
  alert_human("Agent paused due to repeated failures");
}
```

### Action Deduplication
```javascript
const recent_actions = new Map();
function should_act(action) {
  const key = action.type + action.target;
  const last = recent_actions.get(key);
  if (last && Date.now() - last < 3600000) {
    return false;  // Same action within 1hr
  }
  return true;
}
```

## Configuration

### `/packages/autonomous-agent/config.json`
```json
{
  "enabled": false,
  "mode": "dry-run",
  "observation": {
    "interval_seconds": 300,
    "sources": ["email", "calendar", "git"]
  },
  "reasoning": {
    "tier1_model": "qwen2.5:14b",
    "tier2_model": "claude-haiku-4",
    "tier3_model": "claude-sonnet-4-5"
  },
  "action": {
    "whitelist": ["alert", "organize_files", "commit_memory"],
    "rate_limits": {
      "api_calls": 200,
      "actions": 50,
      "alerts": 10
    }
  },
  "safety": {
    "max_cost_per_day": 30,
    "circuit_breaker_threshold": 3,
    "quiet_hours": ["23:00", "08:00"]
  }
}
```

## File Structure

```
packages/autonomous-agent/
├── DESIGN.md              # This file
├── README.md              # User guide
├── package.json
├── config.json            # Configuration
├── src/
│   ├── index.js           # Main entry point
│   ├── loop.js            # Consciousness loop
│   ├── observation.js     # Environment monitoring
│   ├── reasoning.js       # Decision making
│   ├── action.js          # Action execution
│   ├── memory.js          # State persistence
│   ├── control.js         # Start/stop/pause
│   └── safety.js          # Rate limits, circuit breakers
├── data/
│   ├── working-memory.db  # SQLite persistent state
│   └── thought-logs/      # Daily thought logs
└── tests/
    ├── observation.test.js
    ├── reasoning.test.js
    ├── action.test.js
    └── integration.test.js
```

## Integration with Clawdbot

**Phase 1: Separate process**
- Runs independently as Node daemon
- Sends alerts to Clawdbot via gateway API
- No direct coupling

**Phase 2: Optional integration**
- Clawdbot can query agent status
- Agent can request Clawdbot to execute actions
- Shared memory via pipeline

**Phase 3: Full autonomy**
- Agent becomes primary interface
- Clawdbot becomes action executor
- User interacts with agent, agent uses Clawdbot as tool

## Activation Protocol

**DO NOT activate without explicit user command.**

When ready to activate:
1. Review all code thoroughly
2. Run full test suite
3. Start in dry-run mode for 24 hours
4. Review dry-run logs with user
5. If approved, enable live mode
6. Monitor closely for first week

## Cost Projections

**Conservative (mostly Tier 1):**
- Tier 1: 288 cycles/day × $0 = $0
- Tier 2: 12 cycles/day × $0.01 = $0.12
- Tier 3: 3 cycles/day × $1 = $3
- **Total: ~$3-5/day**

**Moderate (more Tier 2/3):**
- Tier 1: 240 cycles/day × $0 = $0
- Tier 2: 40 cycles/day × $0.01 = $0.40
- Tier 3: 8 cycles/day × $1 = $8
- **Total: ~$8-12/day**

**Aggressive (Opus for hard decisions):**
- Tier 1: 200 cycles/day × $0 = $0
- Tier 2: 60 cycles/day × $0.01 = $0.60
- Tier 3: 20 cycles/day × $2 = $40
- **Total: ~$40-50/day** ⚠️ Not sustainable

Target: $10-20/day average.

## Next Steps (for Claude Code wingman)

1. **Create package structure**
   - Set up package.json
   - Create all directories
   - Add to workspace

2. **Implement observation layer**
   - Email monitoring (gog)
   - Calendar sync (gog)
   - Git status checks
   - File system watcher

3. **Implement reasoning layer**
   - Tier 1: Local Ollama integration
   - Tier 2: Haiku API
   - Tier 3: Sonnet/Opus API
   - Cost tracking

4. **Implement action layer**
   - Whitelist enforcement
   - Rate limiting
   - Audit logging
   - Telegram alert integration

5. **Implement memory layer**
   - SQLite setup
   - Working memory CRUD
   - Thought log rotation
   - Checkpointing

6. **Implement control service**
   - CLI commands
   - Health checks
   - Graceful shutdown
   - Emergency stop

7. **Write tests**
   - Unit tests for each component
   - Integration tests
   - Dry-run validation
   - Cost simulation

8. **Documentation**
   - README with usage examples
   - API documentation
   - Troubleshooting guide
   - Activation checklist

## Success Criteria

Before considering "ready":
- [ ] All tests passing
- [ ] Dry-run mode works for 24hr without crashes
- [ ] Cost tracking accurate
- [ ] Rate limits enforced
- [ ] Circuit breakers work
- [ ] Graceful shutdown tested
- [ ] Emergency stop works
- [ ] Documentation complete
- [ ] User reviews and approves dry-run logs
