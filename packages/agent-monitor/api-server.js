/**
 * Agent Monitor API Server
 * 
 * HTTP REST API for dashboard and external integrations.
 * Exposes agent state, command queue, and interaction logs.
 */

const express = require('express');
const cors = require('cors');

class APIServer {
  constructor(monitor, eventBus, commandQueue, port = 3848) {
    this.monitor = monitor;
    this.eventBus = eventBus;
    this.commandQueue = commandQueue;
    this.port = port;
    this.app = express();
    this.server = null;
    
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }
  
  setupRoutes() {
    console.log('[API] Setting up routes...');
    
    // Health check
    this.app.get('/health', (req, res) => {
      console.log('[API] Health check called');
      res.json({ status: 'ok', timestamp: Date.now() });
    });
    
    console.log('[API] Routes registered:', this.app._router.stack.filter(r => r.route).map(r => r.route.path));
    
    // Get all agents
    this.app.get('/api/agents', (req, res) => {
      try {
        const agents = this.monitor.getAllStates();
        res.json({ agents, count: agents.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Get single agent
    this.app.get('/api/agents/:session', (req, res) => {
      try {
        const agent = this.monitor.getState(req.params.session);
        if (!agent) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        res.json(agent);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Get agent interaction log
    this.app.get('/api/agents/:session/log', (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const log = this.monitor.getInteractionLog(req.params.session, limit);
        res.json({ session: req.params.session, log, count: log.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Get agent output (tmux capture)
    this.app.get('/api/agents/:session/output', async (req, res) => {
      try {
        const lines = parseInt(req.query.lines) || 100;
        const session = this.monitor.sessions.get(req.params.session);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        const output = await session.capturePane(lines);
        res.json({ session: req.params.session, output, lines: output.split('\n').length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Send command to agent
    this.app.post('/api/agents/:session/command', async (req, res) => {
      try {
        const { session } = req.params;
        const { command, source = 'api' } = req.body;
        
        if (!command) {
          return res.status(400).json({ error: 'Command required' });
        }
        
        // Enqueue command
        const jobId = await this.eventBus.enqueueCommand(session, command, source);
        
        // Log interaction
        this.monitor.logInteraction(session, source, 'command', command, { jobId });
        
        res.json({ 
          success: true, 
          jobId, 
          session, 
          command,
          status: 'queued' 
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Get command queue for session
    this.app.get('/api/agents/:session/commands', (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const history = this.commandQueue.getHistory(req.params.session, limit);
        res.json({ session: req.params.session, commands: history, count: history.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Get command by ID
    this.app.get('/api/commands/:id', (req, res) => {
      try {
        const command = this.commandQueue.getById(req.params.id);
        if (!command) {
          return res.status(404).json({ error: 'Command not found' });
        }
        res.json(command);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Get recent events
    this.app.get('/api/events', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const events = await this.eventBus.getRecentEvents(limit);
        res.json({ events, count: events.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Kill agent session
    this.app.post('/api/agents/:session/kill', async (req, res) => {
      try {
        const { session } = req.params;
        const tmuxSession = this.monitor.sessions.get(session);
        
        if (!tmuxSession) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        // Disconnect from control mode
        tmuxSession.disconnect();
        
        // Kill tmux session
        const { execFile } = require('child_process');
        execFile('tmux', ['kill-session', '-t', session], (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          // Log interaction
          this.monitor.logInteraction(session, 'api', 'kill', 'Session killed');
          
          // Publish event
          this.eventBus.publishEvent('session_killed', { session });
          
          res.json({ success: true, session });
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    
    // Statistics
    this.app.get('/api/stats', (req, res) => {
      try {
        const agents = this.monitor.getAllStates();
        const pending = this.commandQueue.getPending();
        
        const stats = {
          agents: {
            total: agents.length,
            byState: {},
          },
          commands: {
            pending: pending.length,
          },
          uptime: process.uptime(),
          timestamp: Date.now(),
        };
        
        // Count agents by state
        agents.forEach(agent => {
          stats.agents.byState[agent.state] = (stats.agents.byState[agent.state] || 0) + 1;
        });
        
        res.json(stats);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }
  
  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        console.log(`[API] Server listening on http://0.0.0.0:${this.port}`);
        resolve();
      });
    });
  }
  
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[API] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = APIServer;
