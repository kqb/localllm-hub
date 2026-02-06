# Agent Monitor - Real-Time Agent Monitoring Service

Real-time monitoring of Claude Code agents using tmux control mode, Redis event bus, and persistent command queue.

---

## Quick Start

### Prerequisites

```bash
# Redis (must be running)
redis-cli ping  # Should return PONG

# PM2 (process manager)
npm install -g pm2

# Tmux sessions (agents running)
tmux ls | grep -E "relationship-os|system-improvements"
```

### Start Service

```bash
cd ~/Projects/localllm-hub/packages/agent-monitor

# Start with PM2
./pm2.sh start

# Or manually:
pm2 start ecosystem.config.js
```

### Basic Commands

```bash
# View status
pm2 list

# View logs
pm2 logs agent-monitor

# Restart service
pm2 restart agent-monitor

# Stop service
pm2 stop agent-monitor

# Interactive monitoring
pm2 monit
```

---

## Architecture

```
┌──────────────┐
│  Dashboard   │ ←→ HTTP/WebSocket (port 3848)
└──────┬───────┘
       ↓
┌──────────────────────────────────────┐
│       Agent Monitor Daemon           │
│  - API Server (Express)              │
│  - Event Bus (Redis/BullMQ)          │
│  - Command Queue (Persistent)        │
│  - Tmux Control Mode                 │
└──────┬───────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│  Tmux Sessions (Claude Code Agents)  │
│  - relationship-os-impl              │
│  - relationship-os-ios               │
│  - relationship-os-backend           │
│  - system-improvements               │
└──────────────────────────────────────┘
```

---

## API Endpoints

Base URL: `http://localhost:3848`

### Health Check
```http
GET /health
```

### List All Agents
```http
GET /api/agents
```

Response:
```json
{
  "agents": [
    {
      "session": "system-improvements",
      "state": "working",
      "progress": 35,
      "indicators": {
        "filesWritten": 3,
        "filesRead": 12,
        "contemplationTime": 135
      }
    }
  ]
}
```

### Get Agent Details
```http
GET /api/agents/:session
```

### Send Command to Agent
```http
POST /api/agents/:session/command
Content-Type: application/json

{
  "command": "Continue with implementation",
  "source": "zoid"
}
```

### Get Command History
```http
GET /api/agents/:session/commands?limit=50
```

### Get Agent Output
```http
GET /api/agents/:session/output?lines=100
```

### Kill Agent Session
```http
POST /api/agents/:session/kill
```

### Statistics
```http
GET /api/stats
```

---

## Event Bus (Redis)

### Event Types

**State Changes:**
- `state_change` - Agent changed state (reading → working)
- `progress` - Progress update (35% → 40%)

**Alerts:**
- `agent_stuck` - Agent idle for 5+ minutes
- `agent_error` - Error detected in output
- `agent_complete` - Agent finished task

**Commands:**
- `command_sent` - Command successfully sent to agent
- `command_failed` - Command failed to send

### Subscribing to Events (Example)

```javascript
const Redis = require('ioredis');
const sub = new Redis();

sub.subscribe('agent-events');
sub.on('message', (channel, message) => {
  const event = JSON.parse(message);
  console.log('Event:', event.event, event.session);
});
```

---

## File Structure

```
packages/agent-monitor/
├── daemon.js              # Main orchestrator
├── monitor-v2.js          # Core monitoring logic
├── event-bus.js           # Redis/BullMQ integration
├── command-queue.js       # Persistent command queue
├── tmux-control.js        # Tmux control mode
├── api-server.js          # HTTP REST API
├── ecosystem.config.js    # PM2 configuration
├── pm2.sh                 # PM2 management script
├── README.md              # This file
└── ARCHITECTURE_REVIEW.md # Detailed architecture docs
```

**Data Files:**
```
data/
├── agent-state.db         # SQLite: Agent state + interaction log
└── command-queue.db       # SQLite: Command history
```

---

## PM2 Management

### Start on Boot

```bash
# Generate startup script
pm2 startup

# Copy/paste the command it gives you (requires sudo)
sudo env PATH=$PATH:/usr/local/bin pm2 startup ...

# Save current process list
pm2 save
```

### Monitoring

```bash
# Real-time monitoring dashboard
pm2 monit

# View logs
pm2 logs agent-monitor --lines 100

# Follow logs
pm2 logs agent-monitor -f

# View only errors
pm2 logs agent-monitor --err
```

### Process Management

```bash
# Restart (zero-downtime)
pm2 restart agent-monitor

# Reload (zero-downtime, for cluster mode)
pm2 reload agent-monitor

# Stop
pm2 stop agent-monitor

# Delete from PM2
pm2 delete agent-monitor
```

### Resource Limits

Configured in `ecosystem.config.js`:
- Max memory: 500MB (auto-restart if exceeded)
- Max restarts: 10 (prevents restart loop)
- Min uptime: 10s (must run 10s to count as successful start)

---

## Configuration

### Environment Variables

Set in `ecosystem.config.js` or override via PM2:

```bash
# Redis URL
export REDIS_URL="redis://localhost:6379"

# API Port
export API_PORT="3848"

# Restart with new env
pm2 restart agent-monitor --update-env
```

### Sessions to Monitor

Edit `daemon.js`:

```javascript
const DEFAULT_SESSIONS = [
  'relationship-os-impl',
  'relationship-os-ios',
  'relationship-os-backend',
  'system-improvements',
];
```

Or pass as CLI args:

```bash
pm2 start daemon.js -- session1 session2 session3
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check Redis
redis-cli ping

# Check logs
pm2 logs agent-monitor --err

# Check if port is in use
lsof -i :3848

# Restart Redis
brew services restart redis
```

### Agents Not Connecting

```bash
# Verify tmux sessions exist
tmux ls

# Check if sessions are responsive
tmux capture-pane -t relationship-os-impl -p | tail

# Restart service
pm2 restart agent-monitor
```

### High Memory Usage

```bash
# Check current usage
pm2 list

# View detailed metrics
pm2 show agent-monitor

# Restart to clear memory
pm2 restart agent-monitor
```

### Redis Issues

```bash
# Check Redis status
redis-cli ping

# Check Redis memory
redis-cli info memory

# Clear old jobs (if needed)
redis-cli FLUSHDB  # ⚠️ Deletes all data
```

---

## Development

### Running Without PM2

```bash
# Start directly
node daemon.js

# Or with logging
node daemon.js 2>&1 | tee /tmp/agent-monitor.log
```

### Debugging

```bash
# Enable verbose logging
NODE_ENV=development node daemon.js

# Check database
sqlite3 ../../data/agent-state.db "SELECT * FROM agent_state;"

# Monitor Redis
redis-cli monitor
```

---

## Production Checklist

- [ ] Redis is running and accessible
- [ ] PM2 is installed globally (`npm list -g pm2`)
- [ ] Service starts without errors (`pm2 logs agent-monitor`)
- [ ] API endpoints respond (`curl http://localhost:3848/health`)
- [ ] Startup script configured (`pm2 startup`)
- [ ] Process list saved (`pm2 save`)
- [ ] Resource limits configured (ecosystem.config.js)
- [ ] Monitoring dashboard accessible (`pm2 monit`)

---

## Support

- **Architecture docs:** `ARCHITECTURE_REVIEW.md`
- **Logs:** `/tmp/agent-monitor-out.log`, `/tmp/agent-monitor-error.log`
- **PM2 logs:** `~/.pm2/logs/`
- **Data:** `~/Projects/localllm-hub/data/`

---

## License

Part of localllm-hub project.
