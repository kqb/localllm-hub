#!/bin/bash
# Notify completion via Telegram
# Usage: ./notify-complete.sh "message"

MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
  MESSAGE="✅ Agent Monitor implementation complete!"
fi

# Send via clawdbot gateway wake
clawdbot gateway wake --message "$MESSAGE"

# Also create a completion marker file
echo "$MESSAGE" > /tmp/agent-monitor-complete.txt
echo "$(date)" >> /tmp/agent-monitor-complete.txt

echo "Notification sent: $MESSAGE"
