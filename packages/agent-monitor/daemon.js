#!/usr/bin/env node
/**
 * Agent Monitor Daemon
 * 
 * Standalone service that monitors Claude Code agents in real-time.
 * Uses tmux control mode, Redis event bus, and persistent command queue.
 */

const AgentMonitorV2 = require('./monitor-v2');
const EventBus = require('./event-bus');
const CommandQueueProcessor = require('./command-queue');
const { createAPIServer } = require('./api-server-simple');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const API_PORT = parseInt(process.env.API_PORT || '3848');

// Sessions to monitor (can be passed as CLI args)
const DEFAULT_SESSIONS = [
  'relationship-os-impl',
  'relationship-os-ios',
  'relationship-os-backend',
  'system-improvements',
];

class AgentMonitorDaemon {
  constructor(sessions = DEFAULT_SESSIONS) {
    this.sessions = sessions;
    this.eventBus = null;
    this.monitor = null;
    this.commandQueue = null;
    this.apiServer = null;
  }
  
  async start() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         Agent Monitor Daemon - Real-Time Monitoring           ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    try {
      // 1. Initialize Event Bus (Redis/BullMQ)
      console.log('[Daemon] Initializing Event Bus...');
      this.eventBus = new EventBus(REDIS_URL);
      
      // 2. Initialize Monitor (Control Mode)
      console.log('[Daemon] Initializing Agent Monitor (Control Mode)...');
      this.monitor = new AgentMonitorV2(this.eventBus);
      
      // 3. Initialize Command Queue Processor
      console.log('[Daemon] Initializing Command Queue Processor...');
      this.commandQueue = new CommandQueueProcessor(this.monitor, this.eventBus);
      this.commandQueue.start();
      
      // 4. Initialize API Server (with WebSocket)
      console.log('[Daemon] Starting API Server with WebSocket...');
      this.apiApp = createAPIServer(this.monitor, this.eventBus, this.commandQueue, API_PORT);
      this.apiServer = this.apiApp.startServer(API_PORT, '0.0.0.0');
      
      // 5. Start monitoring sessions
      console.log(`[Daemon] Monitoring ${this.sessions.length} sessions...`);
      await this.monitor.start(this.sessions);
      
      console.log('\n✅ Agent Monitor Daemon started successfully!\n');
      console.log('  API:       http://localhost:' + API_PORT);
      console.log('  Redis:     ' + REDIS_URL);
      console.log('  Sessions:  ' + this.sessions.join(', '));
      console.log('\n  Press Ctrl+C to stop\n');
      
      // Subscribe to events and log them
      await this.eventBus.subscribe((event) => {
        this.logEvent(event);
      });
      
    } catch (err) {
      console.error('❌ Failed to start daemon:', err);
      process.exit(1);
    }
  }
  
  logEvent(event) {
    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    
    switch (event.event) {
      case 'state_change':
        console.log(`[${timestamp}] ${event.session}: ${event.prevState} → ${event.state} (${event.progress}%)`);
        break;
      
      case 'progress':
        if (event.progress % 10 === 0) { // Log every 10%
          console.log(`[${timestamp}] ${event.session}: ${event.progress}% (files: ${event.indicators.filesWritten})`);
        }
        break;
      
      case 'agent_stuck':
        console.log(`[${timestamp}] ⚠️  ${event.session} STUCK (idle ${Math.round(event.idleTime)}s)`);
        break;
      
      case 'agent_error':
        console.log(`[${timestamp}] ❌ ${event.session} ERROR`);
        break;
      
      case 'agent_complete':
        console.log(`[${timestamp}] ✅ ${event.session} COMPLETE`);
        break;
      
      case 'command_sent':
        console.log(`[${timestamp}] 📤 ${event.session}: ${event.command.slice(0, 50)}`);
        break;
      
      case 'command_failed':
        console.log(`[${timestamp}] ❌ ${event.session} command failed: ${event.error}`);
        break;
    }
  }
  
  async stop() {
    console.log('\n[Daemon] Shutting down...');

    // Close WebSocket connections first
    if (this.apiApp && this.apiApp.wsServer) {
      this.apiApp.wsServer.clients.forEach((ws) => {
        ws.close(1001, 'Server shutting down');
      });
      console.log('[WS] All WebSocket connections closed');
    }

    if (this.apiServer) {
      this.apiServer.close(() => {
        console.log('[API] Server stopped');
      });
    }
    
    if (this.commandQueue) {
      await this.commandQueue.stop();
    }
    
    if (this.monitor) {
      await this.monitor.stop();
    }
    
    if (this.eventBus) {
      await this.eventBus.close();
    }
    
    console.log('[Daemon] Stopped');
    process.exit(0);
  }
}

// Run daemon if executed directly
if (require.main === module) {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const sessions = args.length > 0 ? args : DEFAULT_SESSIONS;
  
  const daemon = new AgentMonitorDaemon(sessions);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => daemon.stop());
  process.on('SIGTERM', () => daemon.stop());
  
  // Start daemon
  daemon.start().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = AgentMonitorDaemon;
