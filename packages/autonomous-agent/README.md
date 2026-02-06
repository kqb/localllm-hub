# Autonomous Agent System

**Status:** 🟡 DORMANT - Code exists but NOT activated

## ⚠️ Important Safety Notice

This is **dormant infrastructure**. The agent is **disabled by default** and requires explicit activation with proper review and testing.

**DO NOT activate without:**
1. ✅ Reviewing all safety controls
2. ✅ Running dry-run for 24 hours
3. ✅ Reviewing dry-run logs with user
4. ✅ Explicit user approval
5. ✅ Setting `config.enabled = true`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Consciousness Loop                     │
│         (Observe → Reason → Act → Remember)             │
└────────────┬────────────────────────────────────────────┘
             │
             ├─► 📡 Observation Layer
             │   - Email monitoring (gog CLI)
             │   - Calendar sync
             │   - Git status
             │   - File changes
             │
             ├─► 🧠 Reasoning Layer (Tiered)
             │   - Tier 1: Qwen local (free, fast)
             │   - Tier 2: Haiku ($0.01/call)
             │   - Tier 3: Sonnet/Opus ($1-2/call)
             │
             ├─► ⚡ Action Layer (Whitelisted)
             │   - alert, organize_files
             │   - commit_memory, update_docs
             │   - Rate limited, deduplicated
             │
             └─► 💾 Memory Layer
                 - SQLite working memory
                 - Daily thought logs
                 - Action audit trail
```

## Core Concepts

### Tiered Reasoning

**Cost optimization** through graduated decision-making:

- **95% of cycles:** Tier 1 (Qwen local) — Free, fast triage
- **4% of cycles:** Tier 2 (Haiku) — $0.01/call quick decisions
- **1% of cycles:** Tier 3 (Sonnet/Opus) — $1-2/call deep reasoning

**Target cost:** $10-20/day average

### Safety Controls

1. **Whitelist enforcement:** Only explicitly allowed actions can execute
2. **Rate limiting:** Max 200 API calls/day, 50 actions/day
3. **Cost kill switch:** Auto-pause at $30/day
4. **Circuit breaker:** Auto-pause after 3 consecutive failures
5. **Action deduplication:** Don't repeat same action within 1 hour
6. **Dry-run mode:** Log everything, execute nothing (default)
7. **Quiet hours:** Suppress alerts 23:00-08:00
8. **Audit logging:** Every action recorded in SQLite

### Forbidden Actions

The following actions are **permanently forbidden**:
- `delete_important` — Never delete user data
- `send_message_to_human` — Never impersonate user
- `spend_money` — Never financial transactions
- `modify_code` — Never change code autonomously
- `git_push` — Never push to remote repos

## Installation

```bash
cd ~/Projects/localllm-hub
npm install
```

The package is automatically included via npm workspaces.

## Configuration

Edit `packages/autonomous-agent/config.json`:

```json
{
  "enabled": false,           // ⚠️ MUST be false until activation approved
  "mode": "dry-run",          // "dry-run" or "live"
  "observation": {
    "interval_seconds": 300,  // Check every 5 minutes
    "sources": ["email", "calendar", "git"]
  },
  "reasoning": {
    "tier1_model": "qwen2.5:14b",
    "tier2_model": "claude-3-5-haiku-20241022",
    "tier3_model": "claude-sonnet-4-5"
  },
  "action": {
    "whitelist": ["alert", "organize_files", "commit_memory"],
    "rate_limits": {
      "api_calls_per_day": 200,
      "actions_per_day": 50,
      "alerts_per_hour": 10
    }
  },
  "safety": {
    "max_cost_per_day": 30,
    "circuit_breaker_threshold": 3
  }
}
```

## Usage

### Status Check

```bash
node cli.js agent status
```

Output:
```json
{
  "status": "stopped",
  "started_at": null,
  "cycle_count": 0,
  "safety": {
    "api_calls_today": 0,
    "cost_today": 0,
    "circuit_breaker_open": false
  }
}
```

### Start (Dry-Run)

```bash
node cli.js agent start
```

This runs in **dry-run mode** by default:
- ✅ Observes environment
- ✅ Makes reasoning decisions
- ✅ Logs what actions it WOULD take
- ❌ Does NOT execute any actions
- ✅ Records all decisions to thought logs

### Start (Live Mode) — DISABLED

```bash
node cli.js agent start --live
```

This will **exit with error** until:
1. `config.enabled = true`
2. Dry-run validation completed
3. User approval obtained

### Health Check

```bash
node cli.js agent health
```

Output:
```json
{
  "status": "healthy",
  "checks": {
    "process": { "ok": true },
    "safety": { "ok": true },
    "cost": { "ok": true }
  }
}
```

## Activation Protocol

**DO NOT skip these steps:**

### Phase 1: Review (1 hour)

1. Read `DESIGN.md` completely
2. Review all service implementations
3. Verify safety controls are in place
4. Check whitelist/forbidden actions
5. Confirm rate limits and cost tracking

### Phase 2: Dry-Run (24 hours)

1. Set `config.enabled = true`
2. Set `config.mode = "dry-run"`
3. Start agent: `node cli.js agent start`
4. Monitor thought logs: `packages/autonomous-agent/data/thought-logs/`
5. Check for unexpected behavior
6. Review what actions it wanted to take

### Phase 3: Review Logs (1 hour)

1. Analyze dry-run logs with user
2. Check reasoning quality (were decisions sensible?)
3. Check action deduplication (were repeats prevented?)
4. Check cost projection (would it stay under budget?)
5. Get explicit user approval

### Phase 4: Live Activation (monitored)

1. Set `config.mode = "live"`
2. Start agent: `node cli.js agent start --live`
3. Monitor closely for first 24 hours
4. Be ready to pause immediately
5. Review daily for first week

## File Structure

```
packages/autonomous-agent/
├── DESIGN.md              # Full architecture spec
├── README.md              # This file
├── package.json
├── config.json            # Configuration (enabled: false)
│
├── src/
│   ├── index.js           # Main entry point
│   ├── loop.js            # Consciousness loop
│   ├── observation.js     # Environment monitoring
│   ├── reasoning.js       # Tiered decision making
│   ├── action.js          # Safe action execution
│   ├── memory.js          # State persistence
│   ├── control.js         # Start/stop/pause
│   └── safety.js          # Rate limits, circuit breakers
│
├── data/
│   ├── working-memory.db  # SQLite persistent state
│   ├── agent.pid          # Process ID file
│   ├── agent.state.json   # Control state
│   └── thought-logs/      # Daily JSONL thought logs
│       └── 2026-02-03.jsonl
│
└── tests/
    ├── safety.test.js
    ├── memory.test.js
    ├── observation.test.js
    ├── reasoning.test.js
    ├── action.test.js
    └── integration.test.js
```

## Testing

```bash
cd packages/autonomous-agent
npm test
```

Tests verify:
- ✅ Safety controls enforce limits
- ✅ Memory persistence works
- ✅ Action whitelist blocks forbidden actions
- ✅ Dry-run mode doesn't execute
- ✅ Circuit breaker trips on failures
- ✅ Cost tracking is accurate

## Cost Projections

### Conservative (Target)

- Tier 1: 288 cycles/day × $0 = $0
- Tier 2: 12 cycles/day × $0.01 = $0.12
- Tier 3: 3 cycles/day × $1 = $3
- **Total: ~$3-5/day**

### Moderate

- Tier 1: 240 cycles/day × $0 = $0
- Tier 2: 40 cycles/day × $0.01 = $0.40
- Tier 3: 8 cycles/day × $1 = $8
- **Total: ~$8-12/day**

### ⚠️ Aggressive (Unsustainable)

- Tier 1: 200 cycles/day × $0 = $0
- Tier 2: 60 cycles/day × $0.01 = $0.60
- Tier 3: 20 cycles/day × $2 = $40
- **Total: ~$40-50/day** ⚠️ Would hit kill switch

## Monitoring

### Thought Logs

```bash
tail -f packages/autonomous-agent/data/thought-logs/$(date +%Y-%m-%d).jsonl
```

Each entry:
```json
{
  "timestamp": "2026-02-03T14:30:00Z",
  "cycle": 42,
  "tier": 1,
  "reasoning": "Email from GitHub - low priority notification",
  "decision": "ignore",
  "cost": 0
}
```

### Action History

```sql
sqlite3 packages/autonomous-agent/data/working-memory.db
SELECT * FROM action_history ORDER BY timestamp DESC LIMIT 10;
```

### Safety State

```bash
node cli.js agent status | jq '.safety'
```

Output:
```json
{
  "api_calls_today": 42,
  "actions_today": 8,
  "cost_today": 3.24,
  "circuit_breaker_open": false,
  "quiet_hours": false
}
```

## Troubleshooting

### Agent won't start

**Error:** `Autonomous agent is DISABLED in config`

**Solution:** This is intentional. Review activation protocol above.

### Circuit breaker opened

**Error:** `Circuit breaker open after 3 failures`

**Cause:** Consecutive failures (API errors, crashes)

**Solution:**
```bash
# 1. Check logs
tail -n 100 packages/autonomous-agent/data/thought-logs/$(date +%Y-%m-%d).jsonl

# 2. Fix underlying issue (API credentials, Ollama running, etc)

# 3. Reset circuit breaker (requires code access)
```

### Cost limit reached

**Error:** `Daily cost limit reached`

**Cause:** Exceeded $30/day threshold

**Solution:**
1. Review thought logs to see why (too many Tier 3 calls?)
2. Adjust tier thresholds in config
3. Wait for daily reset (midnight)

### Quiet hours blocking alerts

**Symptom:** No alerts during evening/morning

**Cause:** Quiet hours configured (23:00-08:00)

**Solution:** This is intentional. Adjust `config.safety.quiet_hours` if needed.

## Future Enhancements

Potential improvements (NOT implemented yet):

- [ ] Telegram integration for alerts
- [ ] Web dashboard panel for agent status
- [ ] Learning from user corrections
- [ ] Multi-agent coordination
- [ ] Integration with Clawdbot gateway
- [ ] Adaptive tier thresholds based on performance
- [ ] Predictive scheduling (act before events)

## License

Private / personal use only. Part of localllm-hub project.

## Support

This is dormant code. For activation, contact the user (Kat / kqb).
