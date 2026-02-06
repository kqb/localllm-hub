/**
 * Persistence Layer
 *
 * Append-only JSONL log for all agent signals.
 * Enables state reconstruction after watcher restarts.
 */

const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const { createInterface } = require('readline');

class Persistence {
  constructor(logPath = '/tmp/agent-watcher-history.jsonl') {
    this.logPath = logPath;
    this.writeStream = null;
    this._ensureLogFile();
  }

  /**
   * Ensure log file exists and is writable
   * @private
   */
  _ensureLogFile() {
    try {
      // Create directory if needed
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Open write stream in append mode
      this.writeStream = fs.createWriteStream(this.logPath, {
        flags: 'a',
        encoding: 'utf-8',
      });

      this.writeStream.on('error', (err) => {
        console.error('[Persistence] Write stream error:', err);
      });
    } catch (err) {
      console.error('[Persistence] Failed to initialize log file:', err);
      throw err;
    }
  }

  /**
   * Log a signal to the persistent history
   * @param {string} session - Session name
   * @param {{type: string, payload: string, ts: number}} signal - Signal with timestamp
   */
  logSignal(session, signal) {
    try {
      const entry = {
        session,
        type: signal.type,
        payload: signal.payload || '',
        ts: signal.ts || Date.now(),
      };

      const line = JSON.stringify(entry) + '\n';
      this.writeStream.write(line);
    } catch (err) {
      console.error('[Persistence] Failed to log signal:', err);
    }
  }

  /**
   * Load session state from history (for reconnect after restart)
   * @param {string} session - Session name
   * @returns {Promise<{state: string, progress: number, history: Array}>}
   */
  async loadSessionState(session) {
    const history = [];
    let state = 'spawned';
    let progress = 0;

    try {
      if (!fs.existsSync(this.logPath)) {
        return { state, progress, history };
      }

      const rl = createInterface({
        input: createReadStream(this.logPath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line);
          if (entry.session === session) {
            history.push(entry);

            // Update derived state
            switch (entry.type) {
              case 'PROGRESS':
                progress = parseInt(entry.payload) || progress;
                state = 'working';
                break;
              case 'HELP':
              case 'BLOCKED':
                state = 'waiting_input';
                break;
              case 'ERROR':
                state = 'error';
                break;
              case 'DONE':
                state = 'done';
                progress = 100;
                break;
            }
          }
        } catch (err) {
          // Skip malformed lines
          console.warn('[Persistence] Skipping malformed line:', line.substring(0, 50));
        }
      }
    } catch (err) {
      console.error('[Persistence] Error loading session state:', err);
    }

    return { state, progress, history };
  }

  /**
   * Get history for a specific session
   * @param {string} session - Session name
   * @param {number} limit - Maximum entries to return (default: 50)
   * @returns {Promise<Array>}
   */
  async getHistory(session, limit = 50) {
    const entries = [];

    try {
      if (!fs.existsSync(this.logPath)) {
        return entries;
      }

      const rl = createInterface({
        input: createReadStream(this.logPath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line);
          if (entry.session === session) {
            entries.push(entry);
          }
        } catch (err) {
          // Skip malformed lines
        }
      }
    } catch (err) {
      console.error('[Persistence] Error reading history:', err);
    }

    // Return last N entries
    return entries.slice(-limit);
  }

  /**
   * Get all recent activity across all sessions
   * @param {number} minutes - Time window in minutes (default: 60)
   * @returns {Promise<Array>}
   */
  async getRecentActivity(minutes = 60) {
    const entries = [];
    const cutoff = Date.now() - minutes * 60 * 1000;

    try {
      if (!fs.existsSync(this.logPath)) {
        return entries;
      }

      const rl = createInterface({
        input: createReadStream(this.logPath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line);
          if (entry.ts >= cutoff) {
            entries.push(entry);
          }
        } catch (err) {
          // Skip malformed lines
        }
      }
    } catch (err) {
      console.error('[Persistence] Error reading recent activity:', err);
    }

    return entries;
  }

  /**
   * Close the write stream (for graceful shutdown)
   */
  close() {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

module.exports = Persistence;
