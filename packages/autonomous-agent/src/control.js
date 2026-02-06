import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(__dirname, '../data/agent.pid');
const STATE_FILE = join(__dirname, '../data/agent.state.json');

/**
 * Control service for autonomous agent
 * - Start/stop/pause/resume
 * - Health checks
 * - Status monitoring
 * - Emergency shutdown
 */

class ControlService {
  constructor(loop = null, safety = null, memory = null) {
    this.loop = loop;
    this.safety = safety;
    this.memory = memory;
    this.state = this._loadState();
  }

  /**
   * Load persistent state
   */
  _loadState() {
    if (existsSync(STATE_FILE)) {
      try {
        return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      } catch (e) {
        console.error('[Control] Failed to load state:', e.message);
      }
    }

    return {
      status: 'stopped',
      started_at: null,
      paused_at: null,
      cycle_count: 0,
      last_cycle: null,
      errors: []
    };
  }

  /**
   * Save state to disk
   */
  _saveState() {
    try {
      writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.error('[Control] Failed to save state:', e.message);
    }
  }

  /**
   * Start the agent
   */
  async start(dryRun = true) {
    if (this.state.status === 'running') {
      return { success: false, reason: 'Already running' };
    }

    console.log('[Control] Starting agent', dryRun ? '(DRY-RUN)' : '(LIVE)');

    this.state.status = 'running';
    this.state.started_at = new Date().toISOString();
    this.state.dry_run = dryRun;

    this._writePidFile();
    this._saveState();

    if (this.loop) {
      this.loop.start(dryRun);
    }

    return { success: true };
  }

  /**
   * Stop the agent (graceful)
   */
  async stop() {
    if (this.state.status === 'stopped') {
      return { success: false, reason: 'Already stopped' };
    }

    console.log('[Control] Stopping agent...');

    if (this.loop) {
      await this.loop.stop();
    }

    this.state.status = 'stopped';
    this.state.stopped_at = new Date().toISOString();

    this._removePidFile();
    this._saveState();

    return { success: true };
  }

  /**
   * Pause the agent (stop acting, keep monitoring)
   */
  async pause() {
    if (this.state.status !== 'running') {
      return { success: false, reason: 'Not running' };
    }

    console.log('[Control] Pausing agent...');

    if (this.loop) {
      this.loop.pause();
    }

    this.state.status = 'paused';
    this.state.paused_at = new Date().toISOString();

    this._saveState();

    return { success: true };
  }

  /**
   * Resume the agent
   */
  async resume() {
    if (this.state.status !== 'paused') {
      return { success: false, reason: 'Not paused' };
    }

    console.log('[Control] Resuming agent...');

    if (this.loop) {
      this.loop.resume();
    }

    this.state.status = 'running';
    this.state.resumed_at = new Date().toISOString();

    this._saveState();

    return { success: true };
  }

  /**
   * Emergency kill
   */
  kill() {
    console.log('[Control] EMERGENCY KILL');

    if (this.loop) {
      this.loop.kill();
    }

    this.state.status = 'killed';
    this.state.killed_at = new Date().toISOString();

    this._removePidFile();
    this._saveState();

    process.exit(1);
  }

  /**
   * Get status
   */
  getStatus() {
    const safety = this.safety ? this.safety.getState() : null;
    const memory = this.memory ? {
      recent_thoughts: this.memory.getRecentThoughts(5).length,
      recent_actions: this.memory.getRecentActions(5).length,
      cost_stats: this.memory.getCostStats()
    } : null;

    return {
      ...this.state,
      pid: this._getPid(),
      uptime: this._getUptime(),
      safety,
      memory
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      checks: {},
      timestamp: new Date().toISOString()
    };

    // Check if process is running
    const pid = this._getPid();
    if (pid && !this._isProcessRunning(pid)) {
      health.status = 'unhealthy';
      health.checks.process = { ok: false, message: 'PID file exists but process not running' };
    } else {
      health.checks.process = { ok: true, message: 'Process running' };
    }

    // Check safety state
    if (this.safety) {
      const safetyState = this.safety.getState();
      if (safetyState.circuit_breaker_open) {
        health.status = 'degraded';
        health.checks.safety = { ok: false, message: 'Circuit breaker open' };
      } else {
        health.checks.safety = { ok: true, message: 'Safety controls OK' };
      }
    }

    // Check memory
    if (this.memory) {
      try {
        const costStats = this.memory.getCostStats();
        const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

        if (costStats.today > config.safety.max_cost_per_day * 0.9) {
          health.status = 'warning';
          health.checks.cost = {
            ok: false,
            message: `Cost approaching limit: $${costStats.today.toFixed(2)}`
          };
        } else {
          health.checks.cost = { ok: true, message: 'Cost within limits' };
        }
      } catch (e) {
        health.checks.memory = { ok: false, message: e.message };
      }
    }

    return health;
  }

  /**
   * Write PID file
   */
  _writePidFile() {
    writeFileSync(PID_FILE, String(process.pid));
  }

  /**
   * Remove PID file
   */
  _removePidFile() {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  }

  /**
   * Get PID from file
   */
  _getPid() {
    if (existsSync(PID_FILE)) {
      try {
        return parseInt(readFileSync(PID_FILE, 'utf8'));
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /**
   * Check if process is running
   */
  _isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get uptime in seconds
   */
  _getUptime() {
    if (!this.state.started_at) {
      return 0;
    }

    const start = new Date(this.state.started_at);
    const now = new Date();
    return Math.floor((now - start) / 1000);
  }

  /**
   * Record error
   */
  recordError(error) {
    this.state.errors.push({
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack
    });

    // Keep only last 10 errors
    if (this.state.errors.length > 10) {
      this.state.errors = this.state.errors.slice(-10);
    }

    this._saveState();
  }

  /**
   * Increment cycle count
   */
  incrementCycle() {
    this.state.cycle_count++;
    this.state.last_cycle = new Date().toISOString();
    this._saveState();
  }
}

export default ControlService;
