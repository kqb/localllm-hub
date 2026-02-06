# Routing Configuration

**Status:** ⚠️ **DISABLED** (WIP - routing accuracy needs improvement)

## What is Routing?

The Context Pipeline can automatically route requests to different models based on:
- Task complexity (simple Q&A vs deep reasoning)
- Context requirements (needs memory vs stateless)
- Cost optimization (use cheaper models when possible)

## Current State

**Disabled** as of 2026-02-05 due to routing accuracy issues. The system was routing too aggressively to local models when Claude would be better.

RAG (semantic search), short-term memory, and persistence are still active - only model routing is disabled.

## How to Re-Enable

### Quick Enable (CLI)

```bash
cd ~/Projects/localllm-hub

# Edit config.local.json
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('config.local.json'));
cfg.contextPipeline.routing.enabled = true;
cfg.contextPipeline.routing.enforceModel = true;
fs.writeFileSync('config.local.json', JSON.stringify(cfg, null, 2));
console.log('✅ Routing enabled');
"

# Restart dashboard to apply changes
pkill -f "node cli.js dashboard"
nohup node cli.js dashboard > /tmp/localllm-dashboard.log 2>&1 &
```

### Manual Edit

1. **Edit config:**
   ```bash
   nano ~/Projects/localllm-hub/config.local.json
   ```

2. **Update routing section:**
   ```json
   "routing": {
     "enabled": true,           // ← change to true
     "model": "qwen2.5:14b",
     "fallback": "claude_sonnet",
     "enforceModel": true       // ← change to true
   }
   ```

3. **Restart dashboard:**
   ```bash
   pkill -f "node cli.js dashboard"
   cd ~/Projects/localllm-hub && nohup node cli.js dashboard > /tmp/localllm-dashboard.log 2>&1 &
   ```

### Via Dashboard (when PATCH endpoint added)

Once the dashboard supports config editing:

1. Open `http://192.168.1.49:3847`
2. Go to **Context Pipeline** tab
3. Toggle **Enforce Model Routing** checkbox
4. Changes apply immediately (no restart needed)

## Testing Routing

After re-enabling, test with varied queries:

```bash
# Simple Q&A (should route to Haiku/local)
echo "what is 2+2" | clawdbot send

# Complex task (should route to Sonnet/Opus)
echo "design a distributed system for real-time collaboration" | clawdbot send

# Code task (should route to local code model if available)
echo "write a REST API in Express.js" | clawdbot send
```

Check routing decisions in dashboard: `http://192.168.1.49:3847` → **Recent Routing Decisions** table

## Configuration Options

```json
{
  "routing": {
    "enabled": true,          // Master toggle
    "model": "qwen2.5:14b",   // Model used for routing decisions
    "fallback": "claude_sonnet", // Fallback route when uncertain
    "enforceModel": true,     // Actually override Clawdbot's model selection
    "overrides": {            // Force specific routes for patterns
      "coding": "local_qwen",
      "math": "deepseek_r1"
    }
  }
}
```

## Troubleshooting

**Routing still disabled after restart?**
- Check logs: `tail -100 /tmp/localllm-dashboard.log`
- Verify config: `cat ~/Projects/localllm-hub/config.local.json | jq .contextPipeline.routing`
- Dashboard status: `curl -s http://127.0.0.1:3847/api/context-pipeline/config | jq .config.routing`

**Routes wrong model?**
- Check reasoning in dashboard's **Recent Routing Decisions**
- Adjust `overrides` for specific patterns
- Lower `enforceModel` to false for suggestions only (doesn't override)

## Roadmap

Before re-enabling:
- [ ] Improve routing model accuracy (currently over-routes to local)
- [ ] Add confidence scores to routing decisions
- [ ] Implement A/B testing framework
- [ ] Add user feedback loop ("this should have been Opus")
- [ ] Dashboard toggle for quick disable without config edit
