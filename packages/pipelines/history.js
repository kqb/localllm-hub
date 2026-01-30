const Database = require('better-sqlite3');
const { homedir } = require('os');
const { join } = require('path');
const { existsSync, mkdirSync } = require('fs');

const DEFAULT_DB_PATH = join(homedir(), 'clawd/scripts/pipeline-history.db');

function initHistoryDb(dbPath = DEFAULT_DB_PATH) {
  const dir = join(dbPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration INTEGER,
      success INTEGER NOT NULL,
      result TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.prepare(createTableSql).run();

  return db;
}

async function recordPipelineRun(pipeline, result, dbPath = DEFAULT_DB_PATH) {
  const db = initHistoryDb(dbPath);

  try {
    const stmt = db.prepare(`
      INSERT INTO pipeline_runs (pipeline, timestamp, duration, success, result)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      pipeline,
      result.timestamp,
      result.duration,
      result.success ? 1 : 0,
      JSON.stringify(result)
    );
  } finally {
    db.close();
  }
}

function pipelineHistory(options = {}) {
  const {
    pipeline = null,
    limit = 50,
    dbPath = DEFAULT_DB_PATH,
  } = options;

  if (!existsSync(dbPath)) {
    return [];
  }

  const db = new Database(dbPath);

  try {
    let query = 'SELECT * FROM pipeline_runs';
    const params = [];

    if (pipeline) {
      query += ' WHERE pipeline = ?';
      params.push(pipeline);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    return rows.map(row => ({
      ...row,
      result: JSON.parse(row.result),
      success: Boolean(row.success),
    }));
  } finally {
    db.close();
  }
}

function pipelineStats(dbPath = DEFAULT_DB_PATH) {
  if (!existsSync(dbPath)) {
    return {};
  }

  const db = new Database(dbPath);

  try {
    const stmt = db.prepare(`
      SELECT
        pipeline,
        COUNT(*) as total,
        SUM(success) as successful,
        AVG(duration) as avg_duration,
        MAX(created_at) as last_run
      FROM pipeline_runs
      GROUP BY pipeline
    `);

    const rows = stmt.all();
    const stats = {};

    for (const row of rows) {
      stats[row.pipeline] = {
        total: row.total,
        successful: row.successful,
        failed: row.total - row.successful,
        successRate: (row.successful / row.total * 100).toFixed(1),
        avgDuration: Math.round(row.avg_duration),
        lastRun: row.last_run,
      };
    }

    return stats;
  } finally {
    db.close();
  }
}

module.exports = {
  recordPipelineRun,
  pipelineHistory,
  pipelineStats,
  initHistoryDb,
};
