# Agent Monitor - Quick Start

## Installation

```bash
# 1. Install PM2 globally
npm install -g pm2

# 2. Verify Redis is running
redis-cli ping  # Should return PONG

# 3. Start the service
cd ~/Projects/localllm-hub/packages/agent-monitor
pm2 start ecosystem.config.js
pm2 save
```

## Basic Usage

```bash
# View status
pm2 list

# View logs
pm2 logs agent-monitor

# Restart
pm2 restart agent-monitor

# Stop
pm2 stop agent-monitor

# Interactive monitoring
pm2 monit
```

## API Endpoints

Base URL: `http://localhost:3848`

```bash
# Health check
curl http://localhost:3848/health

# List all agents
curl http://localhost:3848/api/agents | jq

# Get agent details
curl http://localhost:3848/api/agents/system-improvements | jq

# Send command to agent
curl -X POST http://localhost:3848/api/agents/system-improvements/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "Continue with implementation", "source": "zoid"}'

# Statistics
curl http://localhost:3848/api/stats | jq
```

## Start on Boot

```bash
# Generate startup script
pm2 startup

# Run the command it shows (with sudo)
sudo env PATH=$PATH:/usr/local/bin pm2 startup ...

# Save current processes
pm2 save
```

## Troubleshooting

### Service won't start
```bash
# Check Redis
redis-cli ping

# Check logs
pm2 logs agent-monitor --err

# Check if port is in use
lsof -i :3848  # Kill any conflicting process
```

### Agents not connecting
```bash
# Verify tmux sessions exist
tmux ls

# Check if sessions are responsive  
tmux capture-pane -t relationship-os-impl -p | tail

# Restart service
pm2 restart agent-monitor
```

---

**Full documentation:** See `README.md` and `ARCHITECTURE_REVIEW.md`
