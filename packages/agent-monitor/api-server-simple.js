/**
 * API Server with WebSocket Broadcasting
 *
 * Provides HTTP REST API for agent monitoring and WebSocket
 * for real-time event streaming to dashboard clients.
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

/**
 * Create API server with WebSocket support
 */
function createAPIServer(monitor, eventBus, commandQueue, port = 3848) {
  const app = express();
  const server = http.createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use((req, res, next) => {
    console.log(`[API] ${req.method} ${req.path}`);
    next();
  });

  // ============================================
  // HTTP Routes
  // ============================================

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      websocket: {
        clients: clients.size,
        url: `ws://localhost:${port}`
      }
    });
  });

  app.get('/api/agents', (req, res) => {
    try {
      const agents = monitor.getAllStates();
      res.json({ agents, count: agents.length });
    } catch (err) {
      console.error('[API] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents/:session', (req, res) => {
    try {
      const agent = monitor.getState(req.params.session);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      res.json(agent);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents/:session/output', async (req, res) => {
    try {
      const { session } = req.params;
      const lines = parseInt(req.query.lines || '100', 10);

      const tmuxSession = monitor.sessions.get(session);
      if (!tmuxSession) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const output = await tmuxSession.capturePane(lines);
      res.json({ session, output, lines });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents/:session/command', async (req, res) => {
    try {
      const { session } = req.params;
      const { command, source = 'api' } = req.body;

      if (!command) {
        return res.status(400).json({ error: 'Command required' });
      }

      const jobId = await eventBus.enqueueCommand(session, command, source);
      monitor.logInteraction(session, source, 'command', command, { jobId });

      res.json({ success: true, jobId, session, command, status: 'queued' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents/:session/commands', (req, res) => {
    try {
      const { session } = req.params;
      const limit = parseInt(req.query.limit || '50', 10);

      const commands = monitor.getInteractionLog(session, limit)
        .filter(log => log.action === 'command');

      res.json({ commands, count: commands.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents/:session/log', (req, res) => {
    try {
      const { session } = req.params;
      const limit = parseInt(req.query.limit || '50', 10);

      const log = monitor.getInteractionLog(session, limit);
      res.json({ log, count: log.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents/:session/kill', async (req, res) => {
    try {
      const { session } = req.params;
      const tmuxSession = monitor.sessions.get(session);

      if (!tmuxSession) {
        return res.status(404).json({ error: 'Session not found' });
      }

      await tmuxSession.killSession();
      monitor.logInteraction(session, 'api', 'kill', 'Session killed');

      res.json({ success: true, session });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/stats', (req, res) => {
    try {
      const agents = monitor.getAllStates();
      const stats = {
        agents: { total: agents.length, byState: {} },
        websocket: { clients: clients.size },
        uptime: process.uptime(),
        timestamp: Date.now(),
      };

      agents.forEach(agent => {
        stats.agents.byState[agent.state] = (stats.agents.byState[agent.state] || 0) + 1;
      });

      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 404 handler
  app.use((req, res) => {
    console.log('[API] 404:', req.method, req.path);
    res.status(404).json({ error: 'Not found', path: req.path });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('[API] Error:', err);
    res.status(500).json({ error: err.message });
  });

  // ============================================
  // WebSocket Handling
  // ============================================

  wss.on('connection', (ws, req) => {
    const clientId = `${req.socket.remoteAddress}:${Date.now()}`;
    console.log(`[WS] Client connected: ${clientId}`);

    clients.add(ws);

    // Send welcome message with current state
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Agent Monitor WebSocket',
      timestamp: Date.now(),
      clients: clients.size
    }));

    // Handle client messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log(`[WS] Received from ${clientId}:`, message.type);

        // Handle ping/pong
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }

        // Handle subscribe (for future filtering)
        if (message.type === 'subscribe') {
          ws.subscribedSessions = message.sessions || [];
          console.log(`[WS] ${clientId} subscribed to:`, ws.subscribedSessions);
        }
      } catch (err) {
        console.error(`[WS] Error parsing message:`, err);
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      console.log(`[WS] Client disconnected: ${clientId}`);
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client error ${clientId}:`, err);
      clients.delete(ws);
    });
  });

  /**
   * Broadcast event to all connected WebSocket clients
   */
  function broadcast(event) {
    const message = JSON.stringify(event);
    let sent = 0;

    clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        // Optional: Filter by subscribed sessions
        if (ws.subscribedSessions && ws.subscribedSessions.length > 0) {
          if (event.session && !ws.subscribedSessions.includes(event.session)) {
            return; // Skip this client
          }
        }

        ws.send(message);
        sent++;
      }
    });

    if (sent > 0) {
      console.log(`[WS] Broadcast ${event.event || event.type} to ${sent} clients`);
    }
  }

  // ============================================
  // Redis Event Subscription
  // ============================================

  // Subscribe to Redis events and broadcast to WebSocket clients
  eventBus.subscribe((event) => {
    broadcast({
      ...event,
      type: 'event',
      receivedAt: Date.now()
    });
  }).then(() => {
    console.log('[WS] Subscribed to Redis events');
  }).catch((err) => {
    console.error('[WS] Failed to subscribe to Redis:', err);
  });

  // ============================================
  // Server Lifecycle
  // ============================================

  // Store references for external access
  app.wsServer = wss;
  app.httpServer = server;
  app.broadcast = broadcast;
  app.clients = clients;

  // Override listen to use our HTTP server
  app.startServer = (listenPort, host, callback) => {
    return server.listen(listenPort, host, () => {
      console.log(`[API] HTTP server listening on http://${host}:${listenPort}`);
      console.log(`[WS] WebSocket server listening on ws://${host}:${listenPort}`);
      if (callback) callback();
    });
  };

  // Log registered routes (Express 5 compatible)
  try {
    if (app._router && app._router.stack) {
      const routes = app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path);
      console.log('[API] Routes registered:', routes);
    } else {
      console.log('[API] Server initialized (routes registered)');
    }
  } catch (err) {
    console.log('[API] Server initialized');
  }

  return app;
}

module.exports = { createAPIServer };
