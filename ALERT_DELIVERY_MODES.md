# Alert Delivery Modes

## Overview

Added a configurable toggle to switch between two alert delivery modes for agent monitoring alerts.

## Implementation

### 1. Backend Changes

#### `packages/dashboard/websocket-server.js`
- Modified `notifyZoid()` method to check delivery mode config
- Supports two modes:
  - **System Events** (default): `clawdbot system event --text ... --mode now`
  - **Direct Messages**: `clawdbot message send --channel telegram --message ...`

#### `packages/dashboard/server.js`
- Added `GET /api/alerts/delivery-config` - Returns current delivery mode config
- Added `POST /api/alerts/delivery-config` - Updates delivery mode (validates: 'system' or 'direct')
- Config persisted to `data/alerts-config.json`

### 2. Frontend Changes

#### `packages/dashboard/public/index.html`
- Added toggle UI in Agent Monitor section
- Two radio button options with clear descriptions:
  - **System Events (Agent Filters)**: 🤖 Alerts sent to Zoid → agent decides → user sees filtered results
  - **Direct Telegram Messages**: 📱 Alerts sent directly → user sees everything immediately (no filtering)
- Added JavaScript functions:
  - `loadAlertDeliveryConfig()` - Loads current mode on page load
  - `updateAlertDelivery(mode)` - Updates mode via API
  - `highlightSelectedMode(mode)` - Visual feedback for selected option
- Toast notification on successful update
- CSS animations: `@keyframes slideIn` and `@keyframes slideOut`

### 3. Configuration Storage

**File**: `data/alerts-config.json`

```json
{
  "deliveryMode": "system",
  "updatedAt": "2026-02-05T22:30:32.329Z"
}
```

## Usage

### Via Dashboard UI

1. Start dashboard: `node cli.js dashboard`
2. Navigate to **Agent Monitor** tab
3. Select desired alert delivery mode:
   - **System Events (Agent Filters)** - Default, recommended for normal operation
   - **Direct Telegram Messages** - For high-priority scenarios where you want unfiltered alerts

### Via API

**Get current config:**
```bash
curl http://localhost:3847/api/alerts/delivery-config
```

**Switch to direct messages:**
```bash
curl -X POST http://localhost:3847/api/alerts/delivery-config \
  -H "Content-Type: application/json" \
  -d '{"deliveryMode":"direct"}'
```

**Switch to system events:**
```bash
curl -X POST http://localhost:3847/api/alerts/delivery-config \
  -H "Content-Type: application/json" \
  -d '{"deliveryMode":"system"}'
```

## Alert Types

The following alerts are affected by this setting:

- `agent_stuck` - Agent idle for extended period
- `agent_error` - Agent encountered an error
- `agent_complete` - Agent reports task completion
- `nudge_requested` - Manual nudge from dashboard

## Behavior

### System Events Mode (Default)
- Alerts sent via `clawdbot system event --text ... --mode now --json`
- Only Zoid (the agent) sees the alert
- Zoid analyzes context and decides whether to notify user
- Reduces noise - user only sees important alerts
- **Use when**: Normal operation, you trust agent filtering

### Direct Messages Mode
- Alerts sent via `clawdbot message send --channel telegram --message ... --json`
- User sees alert immediately in Telegram
- No filtering - all alerts delivered directly
- Higher notification volume
- **Use when**: High-priority work, debugging, or want unfiltered real-time alerts

## Testing

All endpoints tested and working:

```bash
# GET current config
✅ Returns: {"deliveryMode":"system","updatedAt":"..."}

# POST update to 'direct'
✅ Returns: {"success":true,"config":{...},"message":"..."}

# POST update to 'system'
✅ Returns: {"success":true,"config":{...},"message":"..."}

# Config persistence
✅ Verified: data/alerts-config.json created and updated correctly
```

## UI Features

- Radio button selection with visual feedback (border + background color)
- Status indicator shows current mode: `Current: 🤖 Agent Filters` or `Current: 📱 Direct Messages`
- Toast notification on successful update with slide-in/slide-out animation
- Clear descriptions explain what each mode does
- Loads current setting on page load

## Files Modified

1. `packages/dashboard/websocket-server.js` - Alert delivery logic
2. `packages/dashboard/server.js` - API endpoints
3. `packages/dashboard/public/index.html` - UI toggle + JavaScript + CSS

## Files Created

1. `data/alerts-config.json` - Persisted configuration
2. `ALERT_DELIVERY_MODES.md` - This documentation
