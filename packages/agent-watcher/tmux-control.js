/**
 * Tmux Control Mode
 *
 * Connects to tmux in control mode (-C) for real-time output streaming.
 * Parses %output events and forwards to registered listeners.
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class TmuxControlMode extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // session -> { proc, buffer }
    this.listeners = new Map(); // session -> callback[]
  }

  /**
   * Connect to a tmux session in control mode
   * @param {string} sessionName - Name of the tmux session
   * @returns {Promise<void>}
   */
  async connect(sessionName) {
    if (this.connections.has(sessionName)) {
      console.log(`[TmuxControl] Already connected to ${sessionName}`);
      return;
    }

    return new Promise((resolve, reject) => {
      // Spawn tmux in control mode
      const proc = spawn('tmux', ['-C', 'attach', '-t', sessionName], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const connection = {
        proc,
        buffer: '',
        reconnecting: false,
      };

      this.connections.set(sessionName, connection);

      proc.stdout.on('data', (data) => {
        connection.buffer += data.toString();
        this._processBuffer(sessionName, connection);
      });

      proc.stderr.on('data', (data) => {
        console.error(`[TmuxControl] ${sessionName} stderr:`, data.toString());
      });

      proc.on('error', (err) => {
        console.error(`[TmuxControl] ${sessionName} error:`, err);
        this.emit('error', { session: sessionName, error: err });
        reject(err);
      });

      proc.on('exit', (code) => {
        console.log(`[TmuxControl] ${sessionName} exited with code ${code}`);
        this.connections.delete(sessionName);
        this.emit('disconnect', { session: sessionName, code });
      });

      // Consider connection successful after a short delay
      setTimeout(() => {
        if (this.connections.has(sessionName)) {
          console.log(`[TmuxControl] Connected to ${sessionName}`);
          resolve();
        } else {
          reject(new Error('Connection failed'));
        }
      }, 100);
    });
  }

  /**
   * Process buffered output and parse tmux control mode events
   * @private
   */
  _processBuffer(sessionName, connection) {
    const lines = connection.buffer.split('\n');
    connection.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      this._parseLine(sessionName, line);
    }
  }

  /**
   * Parse a single line from tmux control mode
   * @private
   */
  _parseLine(sessionName, line) {
    if (!line.trim()) return;

    // Parse %output events: %output %<pane_id> <text>
    if (line.startsWith('%output')) {
      const match = line.match(/^%output %(\d+) (.*)$/);
      if (match) {
        const [, paneId, content] = match;
        this._notifyListeners(sessionName, content);
      }
      return;
    }

    // Handle other control mode events
    if (line.startsWith('%session-changed')) {
      console.log(`[TmuxControl] ${sessionName} session changed`);
      return;
    }

    if (line.startsWith('%exit')) {
      console.log(`[TmuxControl] ${sessionName} session ended`);
      this.disconnect(sessionName);
      return;
    }

    // Other lines might be command responses - ignore for now
  }

  /**
   * Notify all registered listeners for a session
   * @private
   */
  _notifyListeners(sessionName, output) {
    const listeners = this.listeners.get(sessionName) || [];
    for (const callback of listeners) {
      try {
        callback(output);
      } catch (err) {
        console.error(`[TmuxControl] Listener error for ${sessionName}:`, err);
      }
    }
  }

  /**
   * Register an output listener for a session
   * @param {string} sessionName - Session to monitor
   * @param {Function} callback - Called with each output event
   */
  onOutput(sessionName, callback) {
    if (!this.listeners.has(sessionName)) {
      this.listeners.set(sessionName, []);
    }
    this.listeners.get(sessionName).push(callback);
  }

  /**
   * Disconnect from a session
   * @param {string} sessionName
   */
  disconnect(sessionName) {
    const connection = this.connections.get(sessionName);
    if (connection) {
      connection.proc.kill();
      this.connections.delete(sessionName);
      this.listeners.delete(sessionName);
      console.log(`[TmuxControl] Disconnected from ${sessionName}`);
    }
  }

  /**
   * Send keys to a session
   * @param {string} sessionName - Target session
   * @param {string} text - Text to send
   * @param {boolean} pressEnter - Whether to press Enter after text
   */
  sendKeys(sessionName, text, pressEnter = true) {
    const { spawn } = require('child_process');
    const args = ['send-keys', '-t', sessionName, text];
    if (pressEnter) {
      args.push('Enter');
    }

    const proc = spawn('tmux', args);
    proc.on('error', (err) => {
      console.error(`[TmuxControl] Failed to send keys to ${sessionName}:`, err);
    });
  }

  /**
   * Disconnect all sessions
   */
  disconnectAll() {
    for (const sessionName of this.connections.keys()) {
      this.disconnect(sessionName);
    }
  }
}

module.exports = TmuxControlMode;
