/**
 * Agent Watcher
 *
 * Main daemon that monitors tmux sessions for agent signals.
 * Ties together tmux control mode, signal parsing, state machines, and webhooks.
 */

const TmuxControlMode = require('./tmux-control');
const SignalParser = require('./signal-parser');
const { SessionState } = require('./session-state');
const WebhookDispatcher = require('./webhook');
const { execFileSync } = require('child_process');

class AgentWatcher {
  constructor(options = {}) {
    this.tmux = new TmuxControlMode();
    this.sessions = new Map(); // sessionName -> SessionState
    this.dispatcher = new WebhookDispatcher(options.webhook || {});
    this.parser = SignalParser;

    // Configuration
    this.scanInterval = options.scanInterval || 10000; // 10s
    this.idleCheckInterval = options.idleCheckInterval || 60000; // 60s
    this.idleThreshold = options.idleThreshold || 300000; // 5 minutes

    // Interval handles
    this._scanTimer = null;
    this._idleCheckTimer = null;
  }

  /**
   * Start watching a specific session
   * @param {string} sessionName - Tmux session name
   */
  async watchSession(sessionName) {
    if (this.sessions.has(sessionName)) {
      console.log(`[Watcher] Already watching: ${sessionName}`);
      return;
    }

    // Create state machine for this session
    const state = new SessionState(sessionName);
    this.sessions.set(sessionName, state);

    // Wire up event handlers
    state.on('complete', (payload) => {
      this.dispatcher.dispatch(sessionName, 'complete', payload);
    });

    state.on('need_input', (payload) => {
      this.dispatcher.dispatch(sessionName, 'need_input', payload);
    });

    state.on('error', (payload) => {
      this.dispatcher.dispatch(sessionName, 'error', payload);
    });

    state.on('blocked', (payload) => {
      this.dispatcher.dispatch(sessionName, 'blocked', payload);
    });

    state.on('progress', (percent) => {
      // Only notify on significant progress milestones
      if (percent % 25 === 0) {
        this.dispatcher.dispatch(sessionName, 'progress', String(percent));
      }
    });

    try {
      // Connect to tmux session
      await this.tmux.connect(sessionName);

      // Register output handler
      this.tmux.onOutput(sessionName, (output) => {
        // Parse for signals
        const signals = this.parser.parse(output);

        // Process each signal
        for (const signal of signals) {
          console.log(`[Watcher] ${sessionName} signal: ${signal.type} ${signal.payload || ''}`);
          state.handleSignal(signal);
        }
      });

      console.log(`[Watcher] Now monitoring: ${sessionName}`);
    } catch (err) {
      console.error(`[Watcher] Failed to watch ${sessionName}:`, err);
      this.sessions.delete(sessionName);
      throw err;
    }
  }

  /**
   * Stop watching a specific session
   * @param {string} sessionName - Tmux session name
   */
  async unwatchSession(sessionName) {
    if (!this.sessions.has(sessionName)) {
      console.log(`[Watcher] Not watching: ${sessionName}`);
      return;
    }

    this.tmux.disconnect(sessionName);
    this.sessions.delete(sessionName);
    console.log(`[Watcher] Stopped monitoring: ${sessionName}`);
  }

  /**
   * Scan for new tmux sessions and auto-watch them
   */
  async scanSessions() {
    try {
      const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      const sessions = output
        .trim()
        .split('\n')
        .filter((s) => s.length > 0);

      // Watch any new sessions
      for (const session of sessions) {
        if (!this.sessions.has(session)) {
          console.log(`[Watcher] Found new session: ${session}`);
          try {
            await this.watchSession(session);
          } catch (err) {
            console.error(`[Watcher] Failed to auto-watch ${session}:`, err.message);
          }
        }
      }

      // Clean up sessions that no longer exist
      const activeSessions = new Set(sessions);
      for (const [name, state] of this.sessions) {
        if (!activeSessions.has(name)) {
          console.log(`[Watcher] Session no longer exists: ${name}`);
          await this.unwatchSession(name);
        }
      }
    } catch (err) {
      // No tmux sessions or tmux not running - not an error
      if (err.message.includes('no server running')) {
        console.log('[Watcher] No tmux server running');
      } else {
        console.error('[Watcher] Failed to scan sessions:', err.message);
      }
    }
  }

  /**
   * Check for idle/stuck sessions
   */
  checkIdleSessions() {
    for (const [name, state] of this.sessions) {
      if (state.isIdle(this.idleThreshold) && state.state === 'working') {
        console.log(`[Watcher] ${name} appears idle (${Math.floor(state.idleMs / 60000)}m)`);
        this.dispatcher.dispatch(name, 'stuck', `Idle for ${Math.floor((Date.now() - state.lastActivity) / 60000)}+ minutes`);
      }
    }
  }

  /**
   * Start the watcher daemon
   */
  async start() {
    console.log('[Watcher] Starting Agent Watcher...');
    console.log(`[Watcher] Config: scan=${this.scanInterval}ms, idleCheck=${this.idleCheckInterval}ms, idleThreshold=${this.idleThreshold}ms`);

    // Initial scan
    await this.scanSessions();

    // Periodic scan for new sessions
    this._scanTimer = setInterval(() => {
      this.scanSessions().catch((err) => {
        console.error('[Watcher] Scan error:', err);
      });
    }, this.scanInterval);

    // Periodic idle check
    this._idleCheckTimer = setInterval(() => {
      this.checkIdleSessions();
    }, this.idleCheckInterval);

    console.log('[Watcher] Started. Press Ctrl+C to stop.');

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * Stop the watcher daemon
   */
  stop() {
    console.log('\n[Watcher] Stopping...');

    // Clear intervals
    if (this._scanTimer) clearInterval(this._scanTimer);
    if (this._idleCheckTimer) clearInterval(this._idleCheckTimer);

    // Disconnect all sessions
    this.tmux.disconnectAll();
    this.sessions.clear();

    console.log('[Watcher] Stopped.');
    process.exit(0);
  }

  /**
   * Get status of all watched sessions
   * @returns {Array} - Array of session status objects
   */
  getStatus() {
    return Array.from(this.sessions.values()).map((state) => state.toJSON());
  }

  /**
   * List all watched session names
   * @returns {Array<string>}
   */
  listSessions() {
    return Array.from(this.sessions.keys());
  }
}

// Run as standalone daemon
if (require.main === module) {
  const watcher = new AgentWatcher();
  watcher.start().catch((err) => {
    console.error('[Watcher] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = AgentWatcher;
