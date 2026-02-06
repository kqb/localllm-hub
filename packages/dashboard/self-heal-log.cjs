const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LOG_PATH = path.join(os.homedir(), '.clawdbot', 'self-heal-log.json');
const MAX_LOG_SIZE = 100;

// In-memory log (loaded from file on startup)
let selfHealLog = [];

/**
 * Generate a simple unique ID
 */
function generateId() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(8).toString('hex');
}

/**
 * Load log from disk into memory
 */
function loadLog() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      const data = fs.readFileSync(LOG_PATH, 'utf-8');
      selfHealLog = JSON.parse(data);
      console.log(`[SelfHealLog] Loaded ${selfHealLog.length} entries from ${LOG_PATH}`);
    } else {
      console.log('[SelfHealLog] No existing log file, starting fresh');
      selfHealLog = [];
    }
  } catch (err) {
    console.error('[SelfHealLog] Failed to load log:', err.message);
    selfHealLog = [];
  }
}

/**
 * Persist log from memory to disk
 */
function saveLog() {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LOG_PATH, JSON.stringify(selfHealLog, null, 2), 'utf-8');
  } catch (err) {
    console.error('[SelfHealLog] Failed to save log:', err.message);
  }
}

/**
 * Add a new self-healing entry
 * @param {Object} entry - { pattern, diagnosis, approach, result, category, status }
 * @returns {Object} - Created entry with id and timestamp
 */
function addEntry(entry) {
  const newEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    pattern: entry.pattern || '',
    diagnosis: entry.diagnosis || '',
    approach: entry.approach || '',
    result: entry.result || '',
    category: entry.category || 'other', // rag | config | performance | other
    status: entry.status || 'fixed', // fixed | monitoring | investigating
  };

  selfHealLog.push(newEntry);

  // Trim to max size
  if (selfHealLog.length > MAX_LOG_SIZE) {
    selfHealLog.shift();
  }

  // Persist to disk
  saveLog();

  return newEntry;
}

/**
 * Get all log entries (most recent first)
 * @param {Number} limit - Max entries to return
 * @returns {Array}
 */
function getEntries(limit = 50) {
  return [...selfHealLog].reverse().slice(0, limit);
}

/**
 * Get statistics summary
 * @returns {Object} - { total, byCategory, byStatus }
 */
function getStats() {
  const byCategory = {};
  const byStatus = {};

  for (const entry of selfHealLog) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
  }

  return {
    total: selfHealLog.length,
    byCategory,
    byStatus,
  };
}

// Load log on module initialization
loadLog();

module.exports = {
  addEntry,
  getEntries,
  getStats,
};
