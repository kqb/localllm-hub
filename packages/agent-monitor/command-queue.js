/**
 * Command Queue Processor
 * 
 * Persistent command queue with retry logic.
 * Processes commands from BullMQ and executes them on tmux sessions.
 */

const { Worker } = require('bullmq');
const Redis = require('ioredis');
const Database = require('better-sqlite3');
const { join } = require('path');
const { existsSync, mkdirSync } = require('fs');

class CommandQueueProcessor {
  constructor(monitor, eventBus, dbPath = null) {
    this.monitor = monitor;
    this.eventBus = eventBus;
    
    // Initialize SQLite database for command history
    const dataDir = join(__dirname, '../../data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    
    this.dbPath = dbPath || join(dataDir, 'command-queue.db');
    this.db = new Database(this.dbPath);
    this.initDatabase();
    
    // Create BullMQ worker
    this.worker = null;
    
    console.log('[CommandQueue] Initialized with database:', this.dbPath);
  }
  
  initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        session TEXT NOT NULL,
        command TEXT NOT NULL,
        source TEXT DEFAULT 'user',
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        sent_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        retry_count INTEGER DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_commands_session ON commands(session);
      CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
      CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(created_at);
    `);
  }
  
  /**
   * Start processing commands from BullMQ
   */
  start() {
    // BullMQ requires maxRetriesPerRequest: null
    const redis = new Redis('redis://localhost:6379', { maxRetriesPerRequest: null });
    
    this.worker = new Worker('agent-commands', async (job) => {
      return await this.processCommand(job);
    }, {
      connection: redis,
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 1000, // 10 commands per second max
      },
    });
    
    this.worker.on('completed', (job) => {
      console.log(`[CommandQueue] Command completed: ${job.id}`);
    });
    
    this.worker.on('failed', (job, err) => {
      console.error(`[CommandQueue] Command failed: ${job.id}`, err.message);
    });
    
    console.log('[CommandQueue] Worker started, processing commands from BullMQ');
  }
  
  /**
   * Process a single command
   */
  async processCommand(job) {
    const { session, command, source } = job.data;
    const jobId = job.id;
    
    console.log(`[CommandQueue] Processing command ${jobId} for ${session}: ${command.slice(0, 50)}`);
    
    // Log to database
    this.logCommand(jobId, session, command, source, 'processing');
    
    try {
      // Get tmux control session
      const tmuxSession = this.monitor.sessions.get(session);
      
      if (!tmuxSession || !tmuxSession.isConnected()) {
        throw new Error(`Session ${session} not connected`);
      }
      
      // Send command to tmux
      await tmuxSession.sendKeys(command);
      
      // Update database
      this.logCommand(jobId, session, command, source, 'sent', null, Date.now());
      
      // Emit event
      await this.eventBus.publishEvent('command_sent', {
        session,
        command,
        jobId,
        source,
      });
      
      return { success: true, jobId, session };
    } catch (err) {
      // Update database with error
      this.logCommand(jobId, session, command, source, 'failed', err.message);
      
      // Emit event
      await this.eventBus.publishEvent('command_failed', {
        session,
        command,
        jobId,
        error: err.message,
      });
      
      throw err; // Let BullMQ handle retry
    }
  }
  
  /**
   * Log command to database
   */
  logCommand(id, session, command, source, status, error = null, sentAt = null) {
    const stmt = this.db.prepare(`
      INSERT INTO commands (id, session, command, source, status, created_at, sent_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        sent_at = COALESCE(excluded.sent_at, sent_at),
        completed_at = CASE WHEN excluded.status IN ('sent', 'failed') THEN ? ELSE NULL END,
        error = COALESCE(excluded.error, error),
        retry_count = retry_count + CASE WHEN excluded.status = 'processing' THEN 1 ELSE 0 END
    `);
    
    const now = Date.now();
    stmt.run(id, session, command, source, status, now, sentAt, error, now);
  }
  
  /**
   * Get command history for a session
   */
  getHistory(session, limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM commands
      WHERE session = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    
    return stmt.all(session, limit);
  }
  
  /**
   * Get all pending commands
   */
  getPending() {
    const stmt = this.db.prepare(`
      SELECT * FROM commands
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `);
    
    return stmt.all();
  }
  
  /**
   * Get command by ID
   */
  getById(id) {
    const stmt = this.db.prepare('SELECT * FROM commands WHERE id = ?');
    return stmt.get(id);
  }
  
  /**
   * Stop worker
   */
  async stop() {
    if (this.worker) {
      await this.worker.close();
      console.log('[CommandQueue] Worker stopped');
    }
    
    this.db.close();
  }
}

module.exports = CommandQueueProcessor;
