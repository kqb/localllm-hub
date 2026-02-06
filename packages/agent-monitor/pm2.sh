#!/bin/bash
# Agent Monitor PM2 Management Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "$1" in
  start)
    echo "🚀 Starting Agent Monitor..."
    pm2 start ecosystem.config.js
    pm2 save
    echo "✅ Agent Monitor started"
    echo "   View logs: pm2 logs agent-monitor"
    echo "   Monitor:   pm2 monit"
    ;;
    
  stop)
    echo "🛑 Stopping Agent Monitor..."
    pm2 stop agent-monitor
    echo "✅ Agent Monitor stopped"
    ;;
    
  restart)
    echo "🔄 Restarting Agent Monitor..."
    pm2 restart agent-monitor
    echo "✅ Agent Monitor restarted"
    ;;
    
  status)
    pm2 list | grep agent-monitor
    ;;
    
  logs)
    pm2 logs agent-monitor
    ;;
    
  monit)
    pm2 monit
    ;;
    
  delete)
    echo "🗑️  Deleting Agent Monitor from PM2..."
    pm2 delete agent-monitor
    pm2 save
    echo "✅ Agent Monitor deleted"
    ;;
    
  startup)
    echo "🔧 Configuring PM2 to start on boot..."
    pm2 startup
    echo ""
    echo "⚠️  Run the command above (with sudo) to enable startup"
    echo "   Then run: pm2 save"
    ;;
    
  *)
    echo "Agent Monitor PM2 Management"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|logs|monit|delete|startup}"
    echo ""
    echo "Commands:"
    echo "  start    - Start the agent monitor"
    echo "  stop     - Stop the agent monitor"
    echo "  restart  - Restart the agent monitor"
    echo "  status   - Show status"
    echo "  logs     - Show live logs"
    echo "  monit    - Interactive monitoring dashboard"
    echo "  delete   - Remove from PM2"
    echo "  startup  - Configure start on boot"
    exit 1
    ;;
esac
