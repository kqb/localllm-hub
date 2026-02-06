#!/bin/bash

# Agent Watcher Service Installer
# Installs the watcher as a launchd user agent (auto-starts on login)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.localllm.agent-watcher.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.localllm.agent-watcher.plist"
SERVICE_LABEL="com.localllm.agent-watcher"

echo "Agent Watcher Service Installer"
echo "================================"
echo ""

# Ensure LaunchAgents directory exists
mkdir -p "$HOME/Library/LaunchAgents"

# Stop service if already running
echo "Stopping existing service (if running)..."
launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" 2>/dev/null || true
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Copy plist
echo "Installing service definition..."
cp "$PLIST_SRC" "$PLIST_DST"

# Load service
echo "Starting service..."
launchctl load "$PLIST_DST"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true

# Verify
sleep 2
if launchctl list | grep -q "$SERVICE_LABEL"; then
    echo ""
    echo "✓ Agent watcher service installed and running"
    echo ""
    echo "Service label: $SERVICE_LABEL"
    echo "Log file:      /tmp/agent-watcher.log"
    echo "History file:  /tmp/agent-watcher-history.jsonl"
    echo ""
    echo "Commands:"
    echo "  launchctl unload $PLIST_DST   # Stop service"
    echo "  launchctl load $PLIST_DST     # Start service"
    echo "  tail -f /tmp/agent-watcher.log  # View logs"
    echo ""
else
    echo ""
    echo "⚠ Service may not have started correctly"
    echo "Check logs: tail -f /tmp/agent-watcher.log"
    exit 1
fi
