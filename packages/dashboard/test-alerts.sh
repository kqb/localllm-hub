#!/usr/bin/env bash
set -e

# Test script for agent alert system
# Usage: ./test-alerts.sh

echo "🧪 Testing Agent Alert System"
echo "================================"

DASHBOARD_URL="http://localhost:3847"

# Check if dashboard is running
echo ""
echo "1️⃣ Checking dashboard..."
if ! curl -s --max-time 3 "$DASHBOARD_URL/api/status" > /dev/null; then
  echo "❌ Dashboard not running. Start it with: node cli.js dashboard"
  exit 1
fi
echo "✅ Dashboard is running"

# Create a test tmux session
echo ""
echo "2️⃣ Creating test agent session..."
SESSION_NAME="test-alert-agent"

# Kill existing test session if it exists
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Create new session
tmux new-session -d -s "$SESSION_NAME"

# Simulate Claude Code output
tmux send-keys -t "$SESSION_NAME" "echo '⏺ Read (config.js)'" Enter
sleep 0.5
tmux send-keys -t "$SESSION_NAME" "echo '✻ Contemplating (3s)...'" Enter
sleep 0.5
tmux send-keys -t "$SESSION_NAME" "echo '⏺ Write (test.js)'" Enter
sleep 0.5
tmux send-keys -t "$SESSION_NAME" "echo '⏺ Bash (npm test)'" Enter
sleep 0.5

echo "✅ Test session created: $SESSION_NAME"
echo "   View with: tmux attach -t $SESSION_NAME"

# Wait for monitor to detect the session
echo ""
echo "3️⃣ Waiting for agent monitor to detect session..."
sleep 10

# Check if session appears in agents API
echo ""
echo "4️⃣ Checking if session is being monitored..."
AGENTS_JSON=$(curl -s "$DASHBOARD_URL/api/agents")
if echo "$AGENTS_JSON" | grep -q "$SESSION_NAME"; then
  echo "✅ Session detected by agent monitor"
else
  echo "⚠️  Session not yet detected. This is normal - agent monitor filters sessions by name pattern."
  echo "   To monitor this session, add it to targetSessions in websocket-server.js"
  echo ""
  echo "   Or use a recognized name pattern like:"
  echo "   - relationship-os-*"
  echo "   - system-improvements"
  echo "   - *claude*"
  echo "   - *omi*"
fi

# Check alert manager state
echo ""
echo "5️⃣ Checking alert manager state..."
ALERT_STATE=$(curl -s "$DASHBOARD_URL/api/alerts/states")
echo "$ALERT_STATE" | jq '.'

# Test suppression
echo ""
echo "6️⃣ Testing alert suppression..."
SUPPRESS_RESULT=$(curl -s -X POST "$DASHBOARD_URL/api/alerts/$SESSION_NAME/suppress" \
  -H 'Content-Type: application/json' \
  -d '{"duration": 1}')
echo "$SUPPRESS_RESULT" | jq '.'

if echo "$SUPPRESS_RESULT" | grep -q '"success":true'; then
  echo "✅ Alert suppression works"
else
  echo "⚠️  Alert suppression failed (WebSocket server may not be initialized yet)"
fi

# Unsuppress
echo ""
echo "7️⃣ Testing unsuppression..."
UNSUPPRESS_RESULT=$(curl -s -X POST "$DASHBOARD_URL/api/alerts/$SESSION_NAME/unsuppress")
echo "$UNSUPPRESS_RESULT" | jq '.'

if echo "$UNSUPPRESS_RESULT" | grep -q '"success":true'; then
  echo "✅ Alert unsuppression works"
fi

# Manual stuck simulation (requires editing monitor.js to reduce STUCK_THRESHOLD for testing)
echo ""
echo "8️⃣ Simulating stuck state..."
echo "   The agent will be detected as STUCK after 5 minutes of inactivity."
echo ""
echo "   To test immediately, you can:"
echo "   a) Edit packages/agent-monitor/monitor.js and change STUCK_THRESHOLD to 10 (10 seconds)"
echo "   b) Restart the dashboard"
echo "   c) Wait 10 seconds"
echo ""
echo "   OR just wait 5 minutes and check your Telegram for an alert from Clawdbot."

# Show dashboard URL
echo ""
echo "================================"
echo "✅ Test setup complete!"
echo ""
echo "📊 Dashboard: $DASHBOARD_URL"
echo "🤖 Test session: $SESSION_NAME"
echo ""
echo "Next steps:"
echo "1. Open the dashboard in your browser"
echo "2. Navigate to '🤖 Agent Monitor' tab"
echo "3. Click on '$SESSION_NAME' to expand"
echo "4. Try the action buttons:"
echo "   - 👋 Nudge: Sends analysis request to Clawdbot"
echo "   - ❌ Kill: Terminates the session"
echo "   - 🔕 Ignore 30m: Suppresses alerts"
echo ""
echo "To trigger a stuck alert immediately:"
echo "  1. Reduce STUCK_THRESHOLD in packages/agent-monitor/monitor.js"
echo "  2. Restart dashboard"
echo "  3. Wait for threshold timeout"
echo ""
echo "Cleanup:"
echo "  tmux kill-session -t $SESSION_NAME"
