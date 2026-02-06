/**
 * WebSocket Server for Real-Time Agent Updates
 * 
 * Broadcasts agent state changes, progress updates, and interaction events
 * to connected dashboard clients.
 */

const WebSocket = require('ws');
const AgentMonitor = require('../agent-monitor/monitor');
const AlertManager = require('./alert-manager.cjs');

class DashboardWebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
    this.clients = new Set();
    this.monitor = new AgentMonitor();
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
    
    // Wire up agent monitor events
    this.monitor.on('state_change', (data) => {
      this.broadcast({ type: 'agent_state', ...data });

      // Reset alert cooldown when agent resumes activity (state changes from STUCK)
      if (data.prevState === 'stuck' && data.state !== 'stuck') {
        this.alertManager.resetCooldown(data.session);
        console.log(`[WebSocket] ${data.session}: resumed from stuck state, alert cooldown reset`);
      }
    });

    this.monitor.on('progress', (data) => {
      this.broadcast({ type: 'progress', ...data });
    });

    this.monitor.on('agent_stuck', (data) => {
      this.broadcast({ type: 'agent_stuck', ...data });

      // Check spam control method
      const config = this.alertManager.getConfig();

      if (config.spamControlMethod === 'batch') {
        // Queue for batching
        if (this.alertManager.shouldAlert(data.session, 'agent_stuck')) {
          this.alertManager.queueAlert(data.session, 'agent_stuck', data);
          this.alertManager.markAlerted(data.session, 'agent_stuck');
        }
      } else {
        // Immediate alert (with spam control)
        if (this.alertManager.shouldAlert(data.session, 'agent_stuck')) {
          this.notifyZoid('agent_stuck', data);
          this.alertManager.markAlerted(data.session, 'agent_stuck');
        }
      }
    });

    this.monitor.on('agent_error', (data) => {
      this.broadcast({ type: 'agent_error', ...data });

      // Check spam control method
      const config = this.alertManager.getConfig();

      if (config.spamControlMethod === 'batch') {
        // Queue for batching
        if (this.alertManager.shouldAlert(data.session, 'agent_error')) {
          this.alertManager.queueAlert(data.session, 'agent_error', data);
          this.alertManager.markAlerted(data.session, 'agent_error');
        }
      } else {
        // Immediate alert (always for errors - they're critical)
        if (this.alertManager.shouldAlert(data.session, 'agent_error')) {
          this.notifyZoid('agent_error', data);
          this.alertManager.markAlerted(data.session, 'agent_error');
        }
      }
    });

    this.monitor.on('agent_complete', (data) => {
      this.broadcast({ type: 'agent_complete', ...data });

      // Check spam control method
      const config = this.alertManager.getConfig();

      if (config.spamControlMethod === 'batch') {
        // Queue for batching
        if (this.alertManager.shouldAlert(data.session, 'agent_complete')) {
          this.alertManager.queueAlert(data.session, 'agent_complete', data);
          this.alertManager.markAlerted(data.session, 'agent_complete');
        }
      } else {
        // Immediate alert (optional, can be disabled if too noisy)
        if (this.alertManager.shouldAlert(data.session, 'agent_complete')) {
          this.notifyZoid('agent_complete', data);
          this.alertManager.markAlerted(data.session, 'agent_complete');
        }
      }
    });
    
    // Start monitoring - auto-detect all Claude-related tmux sessions
    // Pass empty array to enable auto-detection in monitor.js
    this.monitor.start([]);

    // Start batch flush timer if batching is enabled
    const config = this.alertManager.getConfig();
    if (config.spamControlMethod === 'batch') {
      this.startBatchFlushTimer();
    }

    console.log('[WebSocket] Server initialized with auto-detection');
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
    const states = this.monitor.getAllStates();
    ws.send(JSON.stringify({
      type: 'initial_state',
      agents: states,
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
    this.monitor.reloadConfig();

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
    
    // Get current state
    const state = this.monitor.getState(session);
    if (!state) {
      console.warn(`[WebSocket] Session ${session} not found`);
      return;
    }
    
    // Log interaction
    this.monitor.logInteraction(session, 'user', 'nudge', 'User requested nudge', { state: state.state });
    
    // Notify Zoid for analysis
    this.notifyZoid('nudge_requested', {
      session,
      state: state.state,
      progress: state.progress,
      lastOutput: state.last_output,
      idleTime: (Date.now() - state.last_activity) / 1000,
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
    
    // Log interaction
    this.monitor.logInteraction(session, 'user', 'send_command', command);
    
    // Send to tmux
    const { execFile } = require('child_process');
    execFile('tmux', ['send-keys', '-t', session, command, 'Enter'], (err) => {
      if (err) {
        console.error(`[WebSocket] Error sending command to ${session}:`, err);
        this.broadcast({
          type: 'command_failed',
          session,
          error: err.message,
          timestamp: Date.now(),
        });
      } else {
        this.broadcast({
          type: 'command_sent',
          session,
          command,
          timestamp: Date.now(),
        });
      }
    });
  }
  
  handleKill(session) {
    console.log(`[WebSocket] Kill requested for ${session}`);
    
    // Log interaction
    this.monitor.logInteraction(session, 'user', 'kill', 'User requested kill');
    
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

    // Log interaction
    this.monitor.logInteraction(session, 'user', 'suppress_alerts', `Suppressed for ${durationMinutes} minutes`);

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

    // Log interaction
    this.monitor.logInteraction(session, 'user', 'unsuppress_alerts', 'Alerts re-enabled');

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
    this.monitor.logInteraction(session, 'zoid', 'message', message);
    
    this.broadcast({
      type: 'zoid_message',
      session,
      message,
      timestamp: Date.now(),
    });
  }
  
  getMonitor() {
    return this.monitor;
  }
}

module.exports = DashboardWebSocketServer;
