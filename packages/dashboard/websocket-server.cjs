/**
 * WebSocket Server for Real-Time Agent Updates
 * 
 * Broadcasts agent state changes, progress updates, and interaction events
 * to connected dashboard clients.
 */

const WebSocket = require('ws');
const AgentWatcher = require('../agent-watcher/watcher');
const AlertManager = require('./alert-manager.cjs');

class DashboardWebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
    this.clients = new Set();
    this.watcher = new AgentWatcher();
    this.alertManager = new AlertManager();

    this.init();
  }
  
  init() {
    // Handle new WebSocket connections
    this.wss.on('connection', (ws, req) => {
      console.log('[WebSocket] Client connected from', req.socket.remoteAddress);
      this.clients.add(ws);
      
      // Send initial state to new client
      this.sendInitialState(ws);
      
      // Handle client messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleClientMessage(ws, message);
        } catch (err) {
          console.error('[WebSocket] Error parsing message:', err);
        }
      });
      
      // Handle client disconnect
      ws.on('close', () => {
        console.log('[WebSocket] Client disconnected');
        this.clients.delete(ws);
      });
      
      ws.on('error', (err) => {
        console.error('[WebSocket] Client error:', err);
        this.clients.delete(ws);
      });
    });
    
    // Wire up agent watcher events
    // The watcher emits events through individual SessionState instances
    // We'll listen for session updates via periodic status polling instead

    // Start watcher - auto-detects all agent sessions
    this.watcher.start().catch((err) => {
      console.error('[WebSocket] Failed to start agent watcher:', err);
    });

    // Periodically broadcast agent status updates
    this.statusInterval = setInterval(() => {
      const sessions = this.watcher.getStatus();
      this.broadcast({
        type: 'agent_watcher_update',
        sessions,
        timestamp: Date.now()
      });

      // Check for stuck/error/complete states and trigger alerts
      for (const session of sessions) {
        if (session.state === 'error') {
          const config = this.alertManager.getConfig();
          if (config.spamControlMethod === 'batch') {
            if (this.alertManager.shouldAlert(session.session, 'agent_error')) {
              this.alertManager.queueAlert(session.session, 'agent_error', session);
              this.alertManager.markAlerted(session.session, 'agent_error');
            }
          } else {
            if (this.alertManager.shouldAlert(session.session, 'agent_error')) {
              this.notifyZoid('agent_error', session);
              this.alertManager.markAlerted(session.session, 'agent_error');
            }
          }
        } else if (session.state === 'done') {
          const config = this.alertManager.getConfig();
          if (config.spamControlMethod === 'batch') {
            if (this.alertManager.shouldAlert(session.session, 'agent_complete')) {
              this.alertManager.queueAlert(session.session, 'agent_complete', session);
              this.alertManager.markAlerted(session.session, 'agent_complete');
            }
          } else {
            if (this.alertManager.shouldAlert(session.session, 'agent_complete')) {
              this.notifyZoid('agent_complete', session);
              this.alertManager.markAlerted(session.session, 'agent_complete');
            }
          }
        } else if (session.idleMs > 300000 && session.state === 'working') {
          // Stuck detection (5+ minutes idle while working)
          const config = this.alertManager.getConfig();
          if (config.spamControlMethod === 'batch') {
            if (this.alertManager.shouldAlert(session.session, 'agent_stuck')) {
              this.alertManager.queueAlert(session.session, 'agent_stuck', session);
              this.alertManager.markAlerted(session.session, 'agent_stuck');
            }
          } else {
            if (this.alertManager.shouldAlert(session.session, 'agent_stuck')) {
              this.notifyZoid('agent_stuck', session);
              this.alertManager.markAlerted(session.session, 'agent_stuck');
            }
          }
        }
      }
    }, 5000); // Check every 5 seconds

    // Start batch flush timer if batching is enabled
    const config = this.alertManager.getConfig();
    if (config.spamControlMethod === 'batch') {
      this.startBatchFlushTimer();
    }

    console.log('[WebSocket] Server initialized with agent-watcher');
  }

  startBatchFlushTimer() {
    const config = this.alertManager.getConfig();
    const intervalMs = (config.batchWindowSeconds || 30) * 1000;

    // Clear existing timer if any
    if (this.batchFlushInterval) {
      clearInterval(this.batchFlushInterval);
    }

    // Set up periodic flush
    this.batchFlushInterval = setInterval(() => {
      const alerts = this.alertManager.flushBatch();
      if (alerts.length > 0) {
        for (const alert of alerts) {
          this.notifyZoid(alert.event, alert.data);
        }
        console.log(`[WebSocket] Auto-flushed ${alerts.length} batched alert(s)`);
      }
    }, intervalMs);

    console.log(`[WebSocket] Batch flush timer started (every ${config.batchWindowSeconds}s)`);
  }

  stopBatchFlushTimer() {
    if (this.batchFlushInterval) {
      clearInterval(this.batchFlushInterval);
      this.batchFlushInterval = null;
      console.log('[WebSocket] Batch flush timer stopped');
    }
  }
  
  sendInitialState(ws) {
    // Send current state of all agents to newly connected client
    const sessions = this.watcher.getStatus();
    ws.send(JSON.stringify({
      type: 'initial_state',
      agents: sessions,
      timestamp: Date.now(),
    }));
  }
  
  broadcast(message) {
    const data = JSON.stringify(message);
    let sent = 0;
    
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        sent++;
      }
    });
    
    if (sent > 0) {
      console.log(`[WebSocket] Broadcasted ${message.type} to ${sent} client(s)`);
    }
  }
  
  handleClientMessage(ws, message) {
    console.log('[WebSocket] Received:', message.action, 'for', message.session);

    switch (message.action) {
      case 'nudge':
        this.handleNudge(message.session);
        break;
      case 'send_command':
        this.handleSendCommand(message.session, message.command);
        break;
      case 'kill':
        this.handleKill(message.session);
        break;
      case 'request_logs':
        this.handleRequestLogs(ws, message.session, message.lines || 50);
        break;
      case 'suppress_alerts':
        this.handleSuppressAlerts(message.session, message.duration || 30);
        break;
      case 'unsuppress_alerts':
        this.handleUnsuppressAlerts(message.session);
        break;
      case 'reload_alert_config':
        this.handleReloadAlertConfig();
        break;
      case 'flush_batch':
        this.handleFlushBatch();
        break;
      default:
        console.warn('[WebSocket] Unknown action:', message.action);
    }
  }

  handleReloadAlertConfig() {
    this.alertManager.reloadConfig();
    // Note: agent-watcher doesn't need config reload (uses constructor options)

    this.broadcast({
      type: 'config_reloaded',
      message: 'Alert configuration reloaded',
      timestamp: Date.now(),
    });

    console.log('[WebSocket] Alert configuration reloaded');
  }

  handleFlushBatch() {
    const alerts = this.alertManager.flushBatch();

    // Send all batched alerts
    for (const alert of alerts) {
      this.notifyZoid(alert.event, alert.data);
    }

    this.broadcast({
      type: 'batch_flushed',
      count: alerts.length,
      timestamp: Date.now(),
    });

    console.log(`[WebSocket] Manually flushed ${alerts.length} alert(s)`);
  }
  
  handleNudge(session) {
    console.log(`[WebSocket] Nudge requested for ${session}`);

    // Get current state from watcher
    const sessionState = this.watcher.sessions.get(session);
    if (!sessionState) {
      console.warn(`[WebSocket] Session ${session} not found`);
      return;
    }

    const state = sessionState.toJSON();

    // Send Enter key to nudge the session
    this.watcher.tmux.sendKeys(session, '', true);

    // Notify Zoid for analysis
    this.notifyZoid('nudge_requested', {
      session,
      state: state.state,
      progress: state.progress,
      lastOutput: '',
      idleTime: state.idleMs / 1000,
    });

    // Broadcast to dashboard
    this.broadcast({
      type: 'zoid_analyzing',
      session,
      message: 'Zoid is analyzing agent state...',
      timestamp: Date.now(),
    });
  }
  
  handleSendCommand(session, command) {
    console.log(`[WebSocket] Command for ${session}: ${command}`);

    // Send to tmux via watcher
    try {
      this.watcher.tmux.sendKeys(session, command, true);
      this.broadcast({
        type: 'command_sent',
        session,
        command,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(`[WebSocket] Error sending command to ${session}:`, err);
      this.broadcast({
        type: 'command_failed',
        session,
        error: err.message,
        timestamp: Date.now(),
      });
    }
  }
  
  handleKill(session) {
    console.log(`[WebSocket] Kill requested for ${session}`);

    // Kill tmux session
    const { execFile } = require('child_process');
    execFile('tmux', ['kill-session', '-t', session], (err) => {
      if (err) {
        console.error(`[WebSocket] Error killing ${session}:`, err);
        this.broadcast({
          type: 'kill_failed',
          session,
          error: err.message,
          timestamp: Date.now(),
        });
      } else {
        // Unwatch the killed session
        this.watcher.unwatchSession(session).catch(() => {});
        this.broadcast({
          type: 'session_killed',
          session,
          timestamp: Date.now(),
        });
      }
    });
  }
  
  handleRequestLogs(ws, session, lines) {
    const { execFile } = require('child_process');
    execFile('tmux', ['capture-pane', '-t', session, '-p', '-S', '-' + lines], (err, stdout) => {
      if (err) {
        ws.send(JSON.stringify({
          type: 'logs_error',
          session,
          error: err.message,
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'logs',
          session,
          output: stdout,
          timestamp: Date.now(),
        }));
      }
    });
  }

  handleSuppressAlerts(session, durationMinutes) {
    const durationMs = durationMinutes * 60 * 1000;
    this.alertManager.suppressAlerts(session, durationMs);

    // Broadcast to dashboard
    this.broadcast({
      type: 'alerts_suppressed',
      session,
      duration: durationMinutes,
      message: `Alerts suppressed for ${durationMinutes} minutes`,
      timestamp: Date.now(),
    });
  }

  handleUnsuppressAlerts(session) {
    this.alertManager.unsuppressAlerts(session);

    // Broadcast to dashboard
    this.broadcast({
      type: 'alerts_unsuppressed',
      session,
      message: 'Alerts re-enabled',
      timestamp: Date.now(),
    });
  }
  
  notifyZoid(event, data) {
    // Notify Zoid via system event OR direct message (based on config)
    const { execFile } = require('child_process');
    const { existsSync, readFileSync } = require('fs');
    const path = require('path');

    const message = this.formatZoidMessage(event, data);

    // Load alert delivery config
    const configPath = path.join(__dirname, '../../data/alerts-config.json');
    let deliveryMode = 'system'; // default: system events (agent filters)
    
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        deliveryMode = config.deliveryMode || 'system';
      } catch (err) {
        console.warn('[WebSocket] Error loading alerts config:', err.message);
      }
    }

    if (deliveryMode === 'direct') {
      // Direct Telegram message - user sees alert immediately
      execFile('clawdbot', ['message', 'send', '--channel', 'telegram', '--message', message, '--json'], { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('[WebSocket] Error sending direct message:', err.message);
          if (stderr) console.error('[WebSocket] stderr:', stderr);
        } else {
          console.log(`[WebSocket] ✅ Direct message sent for ${event} (${data.session})`);
          try {
            const result = JSON.parse(stdout);
            if (result.error) {
              console.error('[WebSocket] Clawdbot error:', result.error);
            }
          } catch (parseErr) {
            console.log('[WebSocket] Clawdbot output:', stdout.trim());
          }
        }
      });
    } else {
      // System event - only agent (Zoid) sees it and filters
      execFile('clawdbot', ['system', 'event', '--text', message, '--mode', 'now', '--json'], { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('[WebSocket] Error notifying Zoid:', err.message);
          if (stderr) console.error('[WebSocket] stderr:', stderr);
        } else {
          console.log(`[WebSocket] ✅ System event sent to Zoid for ${event} (${data.session})`);
          try {
            const result = JSON.parse(stdout);
            if (result.error) {
              console.error('[WebSocket] Clawdbot error:', result.error);
            }
          } catch (parseErr) {
            console.log('[WebSocket] Clawdbot output:', stdout.trim());
          }
        }
      });
    }
  }
  
  formatZoidMessage(event, data) {
    const dashboardUrl = 'http://localhost:3847';

    switch (event) {
      case 'agent_stuck':
        return `⚠️ Agent \`${data.session}\` stuck for ${Math.round(data.idleTime)}s\n\nLast output:\n\`\`\`\n${data.output.slice(-200)}\n\`\`\`\n\n🔗 Dashboard: ${dashboardUrl}\n\n💡 Actions: nudge, kill, or ignore via dashboard`;

      case 'agent_error':
        return `❌ Agent \`${data.session}\` encountered an error\n\nOutput:\n\`\`\`\n${data.output.slice(-200)}\n\`\`\`\n\n🔗 Dashboard: ${dashboardUrl}\n\n💡 Check logs and intervene if needed`;

      case 'agent_complete':
        return `✅ Agent \`${data.session}\` reports completion\n\nOutput:\n\`\`\`\n${data.output.slice(-200)}\n\`\`\`\n\n🔗 Dashboard: ${dashboardUrl}\n\n💡 Verify results and close session`;

      case 'nudge_requested':
        return `👤 Manual nudge requested for \`${data.session}\`\n\nState: ${data.state} (${data.progress}%)\nIdle: ${Math.round(data.idleTime)}s\n\nLast output:\n\`\`\`\n${data.lastOutput.slice(-200)}\n\`\`\`\n\n🔗 Dashboard: ${dashboardUrl}\n\n💡 Analyzing agent state...`;

      default:
        return `[Agent Event] ${event} for ${data.session}\n\n🔗 Dashboard: ${dashboardUrl}`;
    }
  }
  
  // Public API for server.js to call
  sendZoidMessage(session, message) {
    this.broadcast({
      type: 'zoid_message',
      session,
      message,
      timestamp: Date.now(),
    });
  }

  getWatcher() {
    return this.watcher;
  }

  // Legacy compatibility
  getMonitor() {
    return this.watcher;
  }
}

module.exports = DashboardWebSocketServer;
