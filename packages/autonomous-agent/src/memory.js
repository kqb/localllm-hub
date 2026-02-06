import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configText = readFileSync(join(__dirname, '../config.json'), 'utf8');
const config = JSON.parse(configText);

/**
 * Memory service for autonomous agent
 * - Working memory (hot state)
 * - Thought logs (decision history)
 * - Action history (audit trail)
 * - Checkpointing
 */

class MemoryService {
  constructor(dbPath = null) {
    this.dbPath = dbPath || join(__dirname, '..', config.memory.database);
    this.thoughtLogsDir = join(__dirname, '..', config.memory.thought_logs_dir);

    // Ensure directories exist
    mkdirSync(dirname(this.dbPath), { recursive: true });
    mkdirSync(this.thoughtLogsDir, { recursive: true });

    this.db = new Database(this.dbPath);
    this._initSchema();

    this.workingMemory = this._loadWorkingMemory();
  }

  /**
   * Initialize database schema
   */
  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS working_memory (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS thought_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle INTEGER,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        tier INTEGER,
        reasoning TEXT,
        decision TEXT,
        cost REAL
      );

      CREATE TABLE IF NOT EXISTS action_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        action_type TEXT,
        target TEXT,
        result TEXT,
        error TEXT,
        cost REAL
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        source TEXT,
        event_type TEXT,
        priority TEXT,
        data TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_thought_log_cycle ON thought_log(cycle);
      CREATE INDEX IF NOT EXISTS idx_action_history_timestamp ON action_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp);
    `);
  }

  /**
   * Load working memory from database
   */
  _loadWorkingMemory() {
    const rows = this.db.prepare('SELECT key, value FROM working_memory').all();
    const memory = {
      current_focus: null,
      active_tasks: [],
      recent_observations: [],
      pending_actions: []
    };

    for (const row of rows) {
      try {
        memory[row.key] = JSON.parse(row.value);
      } catch (e) {
        memory[row.key] = row.value;
      }
    }

    return memory;
  }

  /**
   * Update working memory
   */
  setWorkingMemory(key, value) {
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

    this.db.prepare(`
      INSERT INTO working_memory (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(key, valueStr);

    this.workingMemory[key] = value;
  }

  /**
   * Get working memory
   */
  getWorkingMemory(key = null) {
    if (key) {
      return this.workingMemory[key];
    }
    return this.workingMemory;
  }

  /**
   * Log a thought (reasoning step)
   */
  logThought(cycle, tier, reasoning, decision, cost = 0) {
    this.db.prepare(`
      INSERT INTO thought_log (cycle, tier, reasoning, decision, cost)
      VALUES (?, ?, ?, ?, ?)
    `).run(cycle, tier, reasoning, decision, cost);

    // Also append to daily thought log file
    const date = new Date().toISOString().split('T')[0];
    const logFile = join(this.thoughtLogsDir, `${date}.jsonl`);
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      cycle,
      tier,
      reasoning,
      decision,
      cost
    }) + '\n';

    writeFileSync(logFile, logEntry, { flag: 'a' });
  }

  /**
   * Log an action
   */
  logAction(actionType, target, result, error = null, cost = 0) {
    this.db.prepare(`
      INSERT INTO action_history (action_type, target, result, error, cost)
      VALUES (?, ?, ?, ?, ?)
    `).run(actionType, target, result, error, cost);
  }

  /**
   * Log an observation
   */
  logObservation(source, eventType, priority, data) {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

    this.db.prepare(`
      INSERT INTO observations (source, event_type, priority, data)
      VALUES (?, ?, ?, ?)
    `).run(source, eventType, priority, dataStr);
  }

  /**
   * Get recent thoughts
   */
  getRecentThoughts(limit = 10) {
    return this.db.prepare(`
      SELECT * FROM thought_log
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * Get recent actions
   */
  getRecentActions(limit = 10) {
    return this.db.prepare(`
      SELECT * FROM action_history
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * Get recent observations
   */
  getRecentObservations(limit = 10) {
    return this.db.prepare(`
      SELECT * FROM observations
      ORDER BY id DESC
      LIMIT ?
    `).all(limit).map(row => ({
      ...row,
      data: JSON.parse(row.data)
    }));
  }

  /**
   * Get cost statistics
   */
  getCostStats() {
    const today = new Date().toISOString().split('T')[0];

    const thoughtCost = this.db.prepare(`
      SELECT COALESCE(SUM(cost), 0) as total
      FROM thought_log
      WHERE DATE(timestamp) = ?
    `).get(today);

    const actionCost = this.db.prepare(`
      SELECT COALESCE(SUM(cost), 0) as total
      FROM action_history
      WHERE DATE(timestamp) = ?
    `).get(today);

    return {
      today: thoughtCost.total + actionCost.total,
      thought_cost: thoughtCost.total,
      action_cost: actionCost.total
    };
  }

  /**
   * Checkpoint (save state)
   */
  checkpoint() {
    // Working memory is auto-saved on each update
    // Create a checkpoint marker
    this.setWorkingMemory('last_checkpoint', new Date().toISOString());
    return { checkpoint_at: new Date().toISOString() };
  }

  /**
   * Clean up old data
   */
  cleanup(retentionDays = config.memory.retention_days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoff = cutoffDate.toISOString();

    const deleted = {
      thoughts: this.db.prepare('DELETE FROM thought_log WHERE timestamp < ?').run(cutoff).changes,
      actions: this.db.prepare('DELETE FROM action_history WHERE timestamp < ?').run(cutoff).changes,
      observations: this.db.prepare('DELETE FROM observations WHERE timestamp < ?').run(cutoff).changes
    };

    return deleted;
  }

  /**
   * Close database
   */
  close() {
    this.db.close();
  }
}

export default MemoryService;
