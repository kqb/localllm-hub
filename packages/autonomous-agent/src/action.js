import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

/**
 * Action service for autonomous agent
 * Executes decisions with safety controls:
 * - Whitelist enforcement (only safe actions allowed)
 * - Rate limiting
 * - Action deduplication (don't repeat within window)
 * - Audit logging
 * - Dry-run mode support
 */

class ActionService {
  constructor(safety, memory = null, dryRun = true) {
    this.safety = safety;
    this.memory = memory;
    this.dryRun = dryRun;
    this.recentActions = new Map(); // For deduplication
    this.whitelist = new Set(config.action.whitelist);
    this.forbidden = new Set(config.action.forbidden);
  }

  /**
   * Execute an action (with safety checks)
   */
  async execute(actionType, target, data = {}) {
    // 1. Check if action is allowed
    const allowedCheck = this._isActionAllowed(actionType);
    if (!allowedCheck.allowed) {
      console.warn('[Action] Blocked:', allowedCheck.reason);
      if (this.memory) {
        this.memory.logAction(actionType, target, 'blocked', allowedCheck.reason, 0);
      }
      return { success: false, reason: allowedCheck.reason };
    }

    // 2. Check rate limits
    const rateLimitCheck = this.safety.canTakeAction(actionType);
    if (!rateLimitCheck.allowed) {
      console.warn('[Action] Rate limited:', rateLimitCheck.reason);
      if (this.memory) {
        this.memory.logAction(actionType, target, 'rate_limited', rateLimitCheck.reason, 0);
      }
      return { success: false, reason: rateLimitCheck.reason };
    }

    // 3. Check deduplication
    const dedupCheck = this._shouldExecute(actionType, target);
    if (!dedupCheck) {
      console.log('[Action] Deduplicated:', actionType, target);
      if (this.memory) {
        this.memory.logAction(actionType, target, 'deduplicated', 'Same action within window', 0);
      }
      return { success: false, reason: 'Duplicate action' };
    }

    // 4. Execute (or simulate in dry-run mode)
    let result;
    if (this.dryRun) {
      console.log('[Action] DRY-RUN:', actionType, target, data);
      result = { success: true, simulated: true, output: 'Dry-run mode - action not executed' };
    } else {
      result = await this._executeAction(actionType, target, data);
    }

    // 5. Record action
    this.safety.recordAction(actionType);
    this._recordRecentAction(actionType, target);

    if (this.memory) {
      this.memory.logAction(
        actionType,
        target,
        result.success ? 'success' : 'failed',
        result.error || null,
        0
      );
    }

    return result;
  }

  /**
   * Check if action is allowed
   */
  _isActionAllowed(actionType) {
    if (this.forbidden.has(actionType)) {
      return { allowed: false, reason: `Action "${actionType}" is forbidden` };
    }

    if (!this.whitelist.has(actionType)) {
      return { allowed: false, reason: `Action "${actionType}" is not whitelisted` };
    }

    return { allowed: true };
  }

  /**
   * Check if we should execute (deduplication)
   */
  _shouldExecute(actionType, target) {
    const key = `${actionType}:${target}`;
    const lastExecution = this.recentActions.get(key);

    if (!lastExecution) {
      return true;
    }

    const windowMs = config.action.deduplication_window_seconds * 1000;
    const elapsed = Date.now() - lastExecution;

    return elapsed > windowMs;
  }

  /**
   * Record action for deduplication
   */
  _recordRecentAction(actionType, target) {
    const key = `${actionType}:${target}`;
    this.recentActions.set(key, Date.now());

    // Clean up old entries (older than 2x window)
    const maxAge = config.action.deduplication_window_seconds * 2000;
    for (const [k, timestamp] of this.recentActions.entries()) {
      if (Date.now() - timestamp > maxAge) {
        this.recentActions.delete(k);
      }
    }
  }

  /**
   * Execute action (implementation)
   */
  async _executeAction(actionType, target, data) {
    try {
      switch (actionType) {
        case 'alert':
          return await this._alert(target, data);

        case 'organize_files':
          return await this._organizeFiles(target, data);

        case 'commit_memory':
          return await this._commitMemory(target, data);

        case 'update_docs':
          return await this._updateDocs(target, data);

        default:
          return { success: false, error: 'Unknown action type' };
      }
    } catch (error) {
      console.error('[Action] Execution failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Alert action - send notification
   */
  async _alert(message, data) {
    console.log('🔔 [ALERT]', message, data);

    // TODO: Integrate with Telegram bot or notification system
    // For now, just log

    return {
      success: true,
      output: `Alert sent: ${message}`
    };
  }

  /**
   * Organize files action
   */
  async _organizeFiles(target, data) {
    console.log('📁 [ORGANIZE]', target, data);

    // TODO: Implement file organization logic
    // This would be very conservative - maybe just creating directories
    // and moving files matching certain patterns

    return {
      success: true,
      output: `Would organize files in ${target}`
    };
  }

  /**
   * Commit memory action - save observations to memory files
   */
  async _commitMemory(content, data) {
    const memoryDir = join(process.env.HOME, 'clawd', 'memory');
    const date = new Date().toISOString().split('T')[0];
    const memoryFile = join(memoryDir, `${date}.md`);

    const entry = `
## ${new Date().toISOString()}

${content}

---
`;

    if (existsSync(memoryFile)) {
      const existing = readFileSync(memoryFile, 'utf8');
      writeFileSync(memoryFile, existing + entry);
    } else {
      writeFileSync(memoryFile, `# Memory - ${date}\n\n${entry}`);
    }

    console.log('💾 [MEMORY]', `Committed to ${memoryFile}`);

    return {
      success: true,
      output: `Memory committed to ${memoryFile}`
    };
  }

  /**
   * Update docs action - append to documentation
   */
  async _updateDocs(target, data) {
    console.log('📝 [DOCS]', target, data);

    // TODO: Implement doc update logic
    // This would be very conservative - maybe just appending to a notes file

    return {
      success: true,
      output: `Would update docs: ${target}`
    };
  }

  /**
   * Get action statistics
   */
  getStats() {
    return {
      recent_actions: this.recentActions.size,
      whitelist: Array.from(this.whitelist),
      forbidden: Array.from(this.forbidden),
      dry_run: this.dryRun
    };
  }

  /**
   * Clear recent actions (for testing)
   */
  clearRecent() {
    this.recentActions.clear();
  }
}

export default ActionService;
