/**
 * Session State Machine
 *
 * Tracks the lifecycle state of a monitored tmux session.
 * Emits events when signals change the state.
 */

const { EventEmitter } = require('events');

const States = {
  SPAWNED: 'spawned',
  WORKING: 'working',
  WAITING_INPUT: 'waiting_input',
  DONE: 'done',
  ERROR: 'error',
  CLEANED: 'cleaned',
};

class SessionState extends EventEmitter {
  constructor(sessionName) {
    super();
    this.session = sessionName;
    this.state = States.SPAWNED;
    this.progress = 0;
    this.lastActivity = Date.now();
    this.history = []; // Last N signals with timestamps
    this.maxHistory = 50; // Keep last 50 signals
  }

  /**
   * Process a signal and update state
   * @param {{type: string, payload: string}} signal
   */
  handleSignal(signal) {
    this.lastActivity = Date.now();

    // Add to history
    this.history.push({
      ...signal,
      ts: Date.now(),
    });

    // Trim history if too long
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // State transitions based on signal type
    switch (signal.type) {
      case 'PROGRESS':
        this.progress = parseInt(signal.payload) || this.progress;
        this.state = States.WORKING;
        this.emit('progress', this.progress);
        break;

      case 'HELP':
        this.state = States.WAITING_INPUT;
        this.emit('need_input', signal.payload);
        break;

      case 'ERROR':
        this.state = States.ERROR;
        this.emit('error', signal.payload);
        break;

      case 'DONE':
        this.state = States.DONE;
        this.progress = 100;
        this.emit('complete', signal.payload);
        break;

      case 'BLOCKED':
        this.state = States.WAITING_INPUT;
        this.emit('blocked', signal.payload);
        break;

      default:
        // Unknown signal type - log but don't crash
        console.warn(`[SessionState] Unknown signal type: ${signal.type}`);
    }
  }

  /**
   * Check if session has been idle for too long
   * @param {number} thresholdMs - Idle threshold in milliseconds (default: 5 minutes)
   * @returns {boolean}
   */
  isIdle(thresholdMs = 300000) {
    return Date.now() - this.lastActivity > thresholdMs;
  }

  /**
   * Get recent history (last N signals)
   * @param {number} count - Number of recent signals to return
   * @returns {Array}
   */
  getRecentHistory(count = 10) {
    return this.history.slice(-count);
  }

  /**
   * Get serializable state summary
   * @returns {Object}
   */
  toJSON() {
    return {
      session: this.session,
      state: this.state,
      progress: this.progress,
      lastActivity: this.lastActivity,
      idleMs: Date.now() - this.lastActivity,
      recentSignals: this.getRecentHistory(5),
    };
  }
}

module.exports = { SessionState, States };
