/**
 * Tmux Control Session - Hybrid Approach
 *
 * Uses periodic capture-pane for reliable output reading (no event streaming issues).
 * Uses tmux send-keys directly for command sending (instant, reliable).
 *
 * This hybrid approach avoids the reliability issues with tmux control mode's
 * persistent connection which exits immediately without a proper TTY.
 */

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const EventEmitter = require('events');

const execFileAsync = promisify(execFile);

const POLL_INTERVAL = 2000; // 2 seconds between captures
const OUTPUT_BUFFER_LINES = 200; // Keep last 200 lines

class TmuxControlSession extends EventEmitter {
  constructor(sessionName) {
    super();
    this.sessionName = sessionName;
    this.connected = false;
    this.lastOutput = '';
    this.outputBuffer = [];
    this.pollTimer = null;
    this.lastOutputHash = '';
  }

  /**
   * Connect to session (verify it exists, start polling)
   */
  async connect() {
    console.log(`[TmuxControl] Connecting to session: ${this.sessionName}`);

    try {
      // Verify session exists
      const exists = await this.sessionExists();
      if (!exists) {
        throw new Error(`Session '${this.sessionName}' does not exist`);
      }

      // Get initial output
      const initialOutput = await this.capturePane(OUTPUT_BUFFER_LINES);
      this.lastOutput = initialOutput;
      this.outputBuffer = initialOutput.split('\n');
      this.lastOutputHash = this.hashOutput(initialOutput);

      this.connected = true;
      console.log(`[TmuxControl] Connected to ${this.sessionName}`);

      // Start polling for output changes
      this.startPolling();

      // Emit initial output
      this.emit('output', initialOutput, initialOutput);

    } catch (err) {
      console.error(`[TmuxControl] Failed to connect to ${this.sessionName}:`, err.message);
      this.connected = false;
      throw err;
    }
  }

  /**
   * Start polling for output changes
   */
  startPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    this.pollTimer = setInterval(async () => {
      if (!this.connected) {
        clearInterval(this.pollTimer);
        return;
      }

      try {
        const output = await this.capturePane(OUTPUT_BUFFER_LINES);
        const hash = this.hashOutput(output);

        if (hash !== this.lastOutputHash) {
          // Output changed
          const newOutput = this.extractNewOutput(output);
          this.lastOutput = output;
          this.outputBuffer = output.split('\n');
          this.lastOutputHash = hash;

          if (newOutput) {
            this.emit('output', newOutput, output);
            this.emit('activity');
          }
        }
      } catch (err) {
        console.error(`[TmuxControl] ${this.sessionName} poll error:`, err.message);

        // Check if session still exists
        const exists = await this.sessionExists();
        if (!exists) {
          console.log(`[TmuxControl] ${this.sessionName} no longer exists`);
          this.connected = false;
          this.emit('disconnected');
          clearInterval(this.pollTimer);
        }
      }
    }, POLL_INTERVAL);

    console.log(`[TmuxControl] Started polling ${this.sessionName} every ${POLL_INTERVAL}ms`);
  }

  /**
   * Extract new output by comparing with previous
   */
  extractNewOutput(currentOutput) {
    const currentLines = currentOutput.split('\n');
    const previousLines = this.outputBuffer;

    // Find where current differs from previous
    let commonPrefixLen = 0;
    const minLen = Math.min(currentLines.length, previousLines.length);

    for (let i = 0; i < minLen; i++) {
      if (currentLines[i] === previousLines[i]) {
        commonPrefixLen++;
      } else {
        break;
      }
    }

    // New output is everything after the common prefix
    if (commonPrefixLen < currentLines.length) {
      return currentLines.slice(commonPrefixLen).join('\n');
    }

    return '';
  }

  /**
   * Simple hash for change detection
   */
  hashOutput(output) {
    let hash = 0;
    for (let i = 0; i < output.length; i++) {
      const char = output.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * Check if tmux session exists
   */
  async sessionExists() {
    try {
      await execFileAsync('tmux', ['has-session', '-t', this.sessionName], { timeout: 3000 });
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Capture pane output (the reliable way to read tmux)
   */
  async capturePane(lines = 100) {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'capture-pane',
        '-t', this.sessionName,
        '-p',           // Print to stdout
        '-S', `-${lines}` // Start from N lines back
      ], { timeout: 5000 });

      return stdout;
    } catch (err) {
      console.error(`[TmuxControl] ${this.sessionName} capture failed:`, err.message);
      return '';
    }
  }

  /**
   * Send keys to session (uses send-keys, very reliable)
   */
  async sendKeys(keys) {
    if (!this.connected) {
      throw new Error(`Not connected to session ${this.sessionName}`);
    }

    try {
      await execFileAsync('tmux', [
        'send-keys',
        '-t', this.sessionName,
        keys,
        'Enter'
      ], { timeout: 5000 });

      console.log(`[TmuxControl] ${this.sessionName} sent: ${keys.slice(0, 50)}...`);

    } catch (err) {
      console.error(`[TmuxControl] ${this.sessionName} send-keys failed:`, err.message);
      throw err;
    }
  }

  /**
   * Send raw command (without Enter)
   */
  async sendRawKeys(keys) {
    if (!this.connected) {
      throw new Error(`Not connected to session ${this.sessionName}`);
    }

    try {
      await execFileAsync('tmux', [
        'send-keys',
        '-t', this.sessionName,
        keys
      ], { timeout: 5000 });
    } catch (err) {
      console.error(`[TmuxControl] ${this.sessionName} send-keys failed:`, err.message);
      throw err;
    }
  }

  /**
   * Kill the session
   */
  async killSession() {
    try {
      await execFileAsync('tmux', ['kill-session', '-t', this.sessionName], { timeout: 5000 });
      console.log(`[TmuxControl] ${this.sessionName} killed`);
      this.connected = false;
      this.emit('disconnected');
    } catch (err) {
      console.error(`[TmuxControl] ${this.sessionName} kill failed:`, err.message);
      throw err;
    }
  }

  /**
   * Disconnect (stop polling)
   */
  disconnect() {
    console.log(`[TmuxControl] Disconnecting from ${this.sessionName}`);

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.connected = false;
    this.emit('disconnected');
  }

  /**
   * Check connection status
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get last captured output
   */
  getLastOutput() {
    return this.lastOutput;
  }
}

module.exports = TmuxControlSession;
