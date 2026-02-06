#!/usr/bin/env node
/**
 * Agent Monitor V2 - Control Mode Edition
 * 
 * Real-time monitoring using tmux control mode (no polling).
 * Integrates with EventBus for decoupled event publishing.
 */

const Database = require('better-sqlite3');
const { join } = require('path');
const { existsSync, mkdirSync, readFileSync, readdirSync } = require('fs');
const TmuxControlSession = require('./tmux-control');
const os = require('os');

// Agent states
const AgentState = {
  INITIALIZING: 'initializing',
  READING: 'reading',
  THINKING: 'thinking',
  WORKING: 'working',
  TESTING: 'testing',
  IDLE: 'idle',
  STUCK: 'stuck',
  ERROR: 'error',
  COMPLETE: 'complete',
};

const STUCK_THRESHOLD = 300; // 5 minutes

// Common locations for task spec files (relative to project root)
const TASK_SPEC_FILES = [
  'SYSTEM_IMPROVEMENTS.md',
  'TASKS.md',
  'TODO.md',
  'README.md',
  'PLAN.md',
  '.tasks.md',
];

class AgentMonitorV2 {
  constructor(eventBus, dbPath = null) {
    this.eventBus = eventBus;
    this.sessions = new Map(); // session name -> TmuxControlSession
    this.currentState = new Map();
    this.lastActivity = new Map();
    this.progressData = new Map();
    this.taskSpecs = new Map(); // session -> { total, completed, items, lastUpdated }
    this.taskSpecCache = new Map(); // file path -> { mtime, spec }
    
    // Initialize database
    const dataDir = join(__dirname, '../../data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    
    this.dbPath = dbPath || join(dataDir, 'agent-state.db');
    this.db = new Database(this.dbPath);
    this.initDatabase();
    
    // Stuck detection timer
    this.stuckCheckInterval = null;
    
    console.log('[AgentMonitor] Initialized (Control Mode)');
  }
  
  initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_state (
        session TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        last_activity INTEGER,
        last_output TEXT,
        files_read INTEGER DEFAULT 0,
        files_written INTEGER DEFAULT 0,
        files_edited INTEGER DEFAULT 0,
        bash_commands INTEGER DEFAULT 0,
        contemplation_time INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS interaction_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        content TEXT,
        metadata TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_interaction_session ON interaction_log(session);
      CREATE INDEX IF NOT EXISTS idx_interaction_timestamp ON interaction_log(timestamp);

      -- Task spec cache table
      CREATE TABLE IF NOT EXISTS task_specs (
        session TEXT PRIMARY KEY,
        spec_file TEXT,
        total_tasks INTEGER DEFAULT 0,
        completed_tasks INTEGER DEFAULT 0,
        items TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Parse task spec file for checkboxes
   * Returns { total, completed, items: [{text, done}] }
   */
  parseTaskSpec(filePath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const items = [];

      // Match markdown checkboxes: - [ ] or - [x] or - [X]
      const checkboxRegex = /^[\s]*[-*]\s*\[([ xX])\]\s*(.+)$/;

      for (const line of lines) {
        const match = line.match(checkboxRegex);
        if (match) {
          const done = match[1].toLowerCase() === 'x';
          const text = match[2].trim();
          items.push({ text, done });
        }
      }

      const total = items.length;
      const completed = items.filter(item => item.done).length;

      return { total, completed, items };
    } catch (err) {
      return null;
    }
  }

  /**
   * Find task spec file for a session
   * Looks in common locations based on session name
   */
  findTaskSpecFile(sessionName) {
    // Common project root paths based on session naming conventions
    const homeDir = os.homedir();
    const possibleRoots = [
      join(homeDir, 'Projects', sessionName),
      join(homeDir, 'Projects', sessionName.replace('-impl', '')),
      join(homeDir, 'Projects', sessionName.replace('-ios', '')),
      join(homeDir, 'Projects', sessionName.replace('-backend', '')),
      join(homeDir, sessionName),
      join(homeDir, 'clawd', 'projects', sessionName),
    ];

    // Also check current directory structure
    possibleRoots.push(join(__dirname, '../../'));

    for (const root of possibleRoots) {
      if (!existsSync(root)) continue;

      for (const specFile of TASK_SPEC_FILES) {
        const fullPath = join(root, specFile);
        if (existsSync(fullPath)) {
          return fullPath;
        }
      }
    }

    return null;
  }

  /**
   * Get task spec for session (with caching)
   */
  getTaskSpec(sessionName) {
    const cached = this.taskSpecs.get(sessionName);
    const now = Date.now();

    // Return cache if fresh (less than 30 seconds old)
    if (cached && (now - cached.lastUpdated) < 30000) {
      return cached;
    }

    // Find and parse spec file
    const specFile = this.findTaskSpecFile(sessionName);
    if (!specFile) {
      // No spec file found, return default
      return { total: 0, completed: 0, items: [], specFile: null, lastUpdated: now };
    }

    const parsed = this.parseTaskSpec(specFile);
    if (!parsed || parsed.total === 0) {
      return { total: 0, completed: 0, items: [], specFile, lastUpdated: now };
    }

    const spec = {
      total: parsed.total,
      completed: parsed.completed,
      items: parsed.items,
      specFile,
      lastUpdated: now
    };

    // Cache it
    this.taskSpecs.set(sessionName, spec);

    // Store in database
    this.updateTaskSpecDb(sessionName, spec);

    return spec;
  }

  /**
   * Update task spec in database
   */
  updateTaskSpecDb(session, spec) {
    const stmt = this.db.prepare(`
      INSERT INTO task_specs (session, spec_file, total_tasks, completed_tasks, items, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session) DO UPDATE SET
        spec_file = excluded.spec_file,
        total_tasks = excluded.total_tasks,
        completed_tasks = excluded.completed_tasks,
        items = excluded.items,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      session,
      spec.specFile || '',
      spec.total,
      spec.completed,
      JSON.stringify(spec.items),
      Date.now()
    );
  }
  
  /**
   * Start monitoring sessions
   */
  async start(sessionNames = []) {
    console.log(`[AgentMonitor] Starting monitoring for ${sessionNames.length} sessions`);
    
    for (const name of sessionNames) {
      await this.monitorSession(name);
    }
    
    // Start stuck detection
    this.stuckCheckInterval = setInterval(() => {
      this.checkStuckSessions();
    }, 30000); // Check every 30 seconds
    
    console.log('[AgentMonitor] All sessions connected');
  }
  
  /**
   * Monitor a single session using control mode
   */
  async monitorSession(sessionName) {
    try {
      const session = new TmuxControlSession(sessionName);
      
      // Connect to session
      await session.connect();
      
      this.sessions.set(sessionName, session);
      this.lastActivity.set(sessionName, Date.now());
      this.currentState.set(sessionName, AgentState.INITIALIZING);
      
      // Wire up events
      session.on('output', (newOutput, fullOutput) => {
        this.handleOutput(sessionName, newOutput, fullOutput);
      });
      
      session.on('activity', () => {
        this.lastActivity.set(sessionName, Date.now());
      });
      
      session.on('disconnected', () => {
        console.log(`[AgentMonitor] ${sessionName} disconnected`);
        this.sessions.delete(sessionName);
      });
      
      session.on('error', (err) => {
        console.error(`[AgentMonitor] ${sessionName} error:`, err);
      });
      
      console.log(`[AgentMonitor] Connected to ${sessionName}`);
      
      // Get initial output
      const initialOutput = await session.capturePane(100);
      if (initialOutput) {
        this.handleOutput(sessionName, initialOutput, initialOutput);
      }
    } catch (err) {
      console.error(`[AgentMonitor] Failed to connect to ${sessionName}:`, err.message);
    }
  }
  
  /**
   * Handle output from session
   */
  handleOutput(sessionName, newOutput, fullOutput) {
    const now = Date.now();
    this.lastActivity.set(sessionName, now);
    
    // Detect state
    const prevState = this.currentState.get(sessionName);
    const newState = this.detectState(fullOutput, prevState, 0);
    
    if (newState !== prevState) {
      this.currentState.set(sessionName, newState);
      console.log(`[AgentMonitor] ${sessionName}: ${prevState} → ${newState}`);
      
      // Parse progress
      const { progress, indicators } = this.parseProgress(fullOutput, sessionName);
      this.progressData.set(sessionName, { progress, indicators });
      
      // Update database
      this.updateDatabase(sessionName, newState, progress, indicators, fullOutput.slice(-2000));
      
      // Publish event
      this.eventBus.publishEvent('state_change', {
        session: sessionName,
        state: newState,
        prevState,
        progress,
        indicators,
      });
      
      // Special events
      if (newState === AgentState.ERROR) {
        this.eventBus.publishEvent('agent_error', {
          session: sessionName,
          output: fullOutput.slice(-1000),
        });
      } else if (newState === AgentState.COMPLETE) {
        this.eventBus.publishEvent('agent_complete', {
          session: sessionName,
          output: fullOutput.slice(-1000),
        });
      }
    }
    
    // Always update progress
    const { progress, indicators } = this.parseProgress(fullOutput, sessionName);
    const prevProgress = this.progressData.get(sessionName)?.progress || 0;
    
    if (progress !== prevProgress) {
      this.progressData.set(sessionName, { progress, indicators });
      this.eventBus.publishEvent('progress', {
        session: sessionName,
        progress,
        indicators,
      });
    }
  }
  
  /**
   * Check for stuck sessions
   */
  checkStuckSessions() {
    const now = Date.now();
    
    for (const [sessionName, lastAct] of this.lastActivity.entries()) {
      const idleTime = (now - lastAct) / 1000;
      const currentState = this.currentState.get(sessionName);
      
      if (idleTime > STUCK_THRESHOLD && currentState !== AgentState.STUCK && currentState !== AgentState.COMPLETE) {
        console.log(`[AgentMonitor] ${sessionName} stuck (idle ${Math.round(idleTime)}s)`);
        
        this.currentState.set(sessionName, AgentState.STUCK);
        this.updateDatabase(sessionName, AgentState.STUCK, null, null, null);
        
        // Get current output
        const session = this.sessions.get(sessionName);
        session.capturePane(100).then(output => {
          this.eventBus.publishEvent('agent_stuck', {
            session: sessionName,
            idleTime,
            output,
          });
        });
      }
    }
  }
  
  detectState(output, lastState, idleTime) {
    if (output.includes('✻ Contemplating') || output.includes('✶ Contemplating')) {
      return AgentState.THINKING;
    }
    if (output.includes('⏺ Read') && !output.includes('⏺ Write')) {
      return AgentState.READING;
    }
    if (output.includes('⏺ Write') || output.includes('⏺ Edit')) {
      return AgentState.WORKING;
    }
    if (output.includes('⏺ Bash') && output.includes('test')) {
      return AgentState.TESTING;
    }
    if ((output.includes('✅') && output.includes('complete')) || output.includes('Task complete')) {
      return AgentState.COMPLETE;
    }
    if (output.includes('Error:') || output.includes('✗') || output.includes('[ERROR]')) {
      return AgentState.ERROR;
    }
    if (output.trim().endsWith('❯') && idleTime > STUCK_THRESHOLD) {
      return AgentState.STUCK;
    }
    if (output.trim().endsWith('❯')) {
      return AgentState.IDLE;
    }
    
    return lastState || AgentState.IDLE;
  }
  
  parseProgress(output, session) {
    const indicators = {
      filesRead: (output.match(/⏺ Read (\d+) files?/g) || []).length,
      filesWritten: (output.match(/⏺ Write\(/g) || []).length,
      filesEdited: (output.match(/⏺ Edit\(/g) || []).length,
      bashCommands: (output.match(/⏺ Bash\(/g) || []).length,
      contemplations: (output.match(/[✻✶] Contemplating/g) || []).length,
      thinkingTime: this.extractThinkingTime(output),
      errors: (output.match(/(Error:|✗|\[ERROR\])/g) || []).length,
    };

    // Try to get progress from task spec file (checkboxes)
    const taskSpec = this.getTaskSpec(session);

    let progress = 0;
    let progressSource = 'output';

    if (taskSpec.total > 0) {
      // Use task spec checkboxes for progress
      progress = Math.round((taskSpec.completed / taskSpec.total) * 100);
      progressSource = 'taskspec';
      indicators.taskSpecTotal = taskSpec.total;
      indicators.taskSpecCompleted = taskSpec.completed;
      indicators.taskSpecFile = taskSpec.specFile;
    } else {
      // Fallback to output-based heuristic
      const completed = indicators.filesWritten + indicators.filesEdited + indicators.bashCommands;
      // Estimate based on session type
      let estimated = 10;
      if (session.includes('impl') || session.includes('backend')) {
        estimated = 15; // Implementation tasks are usually larger
      } else if (session.includes('ios') || session.includes('frontend')) {
        estimated = 12; // UI tasks are medium
      }
      progress = Math.min(100, Math.round((completed / estimated) * 100));
    }

    indicators.progressSource = progressSource;

    return { progress, indicators };
  }
  
  extractThinkingTime(output) {
    const matches = output.match(/Contemplating[^(]*\((\d+)s/g);
    if (!matches) return 0;
    
    let total = 0;
    for (const match of matches) {
      const seconds = match.match(/(\d+)s/);
      if (seconds) total += parseInt(seconds[1], 10);
    }
    return total;
  }
  
  updateDatabase(session, state, progress, indicators, output) {
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      INSERT INTO agent_state (
        session, state, progress, last_activity, last_output,
        files_read, files_written, files_edited, bash_commands,
        contemplation_time, error_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session) DO UPDATE SET
        state = excluded.state,
        progress = COALESCE(excluded.progress, progress),
        last_activity = excluded.last_activity,
        last_output = COALESCE(excluded.last_output, last_output),
        files_read = COALESCE(excluded.files_read, files_read),
        files_written = COALESCE(excluded.files_written, files_written),
        files_edited = COALESCE(excluded.files_edited, files_edited),
        bash_commands = COALESCE(excluded.bash_commands, bash_commands),
        contemplation_time = COALESCE(excluded.contemplation_time, contemplation_time),
        error_count = COALESCE(excluded.error_count, error_count),
        updated_at = excluded.updated_at
    `);
    
    stmt.run(
      session,
      state,
      progress,
      now,
      output,
      indicators?.filesRead || 0,
      indicators?.filesWritten || 0,
      indicators?.filesEdited || 0,
      indicators?.bashCommands || 0,
      indicators?.thinkingTime || 0,
      indicators?.errors || 0,
      now
    );
  }
  
  logInteraction(session, actor, action, content, metadata = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO interaction_log (session, timestamp, actor, action, content, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      session,
      Date.now(),
      actor,
      action,
      content,
      JSON.stringify(metadata)
    );
  }
  
  getState(session) {
    return this.db.prepare('SELECT * FROM agent_state WHERE session = ?').get(session);
  }
  
  getAllStates() {
    return this.db.prepare('SELECT * FROM agent_state ORDER BY updated_at DESC').all();
  }
  
  getInteractionLog(session, limit = 50) {
    return this.db.prepare(`
      SELECT * FROM interaction_log
      WHERE session = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(session, limit);
  }
  
  async stop() {
    console.log('[AgentMonitor] Stopping...');
    
    // Clear interval
    if (this.stuckCheckInterval) {
      clearInterval(this.stuckCheckInterval);
    }
    
    // Disconnect all sessions
    for (const [name, session] of this.sessions.entries()) {
      session.disconnect();
    }
    
    this.db.close();
    console.log('[AgentMonitor] Stopped');
  }
}

module.exports = AgentMonitorV2;
module.exports.AgentState = AgentState;
