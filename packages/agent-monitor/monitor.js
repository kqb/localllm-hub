#!/usr/bin/env node
/**
 * Agent Monitor Service
 * 
 * Real-time monitoring of Claude Code agents in tmux sessions.
 * Detects state changes, tracks progress, emits events via WebSocket.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const EventEmitter = require('events');
const Database = require('better-sqlite3');
const { join } = require('path');
const { existsSync, readFileSync } = require('fs');

const execFileAsync = promisify(execFile);

// Configuration
const POLL_INTERVAL = 5000; // Poll every 5 seconds
const DATA_DIR = join(__dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'agent-state.db');
const CONFIG_PATH = join(DATA_DIR, 'alerts-config.json');

// Load stuck threshold from config
function loadStuckThreshold() {
  const defaultThreshold = 300; // 5 minutes default

  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      return config.stuckThresholdSeconds || defaultThreshold;
    } catch (err) {
      console.warn('[Agent Monitor] Error loading config:', err.message);
      return defaultThreshold;
    }
  }

  return defaultThreshold;
}

let STUCK_THRESHOLD = loadStuckThreshold();

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

class AgentMonitor extends EventEmitter {
  constructor() {
    super();
    this.sessions = [];
    this.lastHash = new Map();
    this.lastActivity = new Map();
    this.currentState = new Map();
    this.progressData = new Map();
    this.cumulativeIndicators = new Map(); // Track cumulative file/command counts
    this.lastSeenIndicators = new Map();   // Track last visible counts to detect new activity
    
    // Initialize database
    this.initDatabase();
    
    console.log('[Agent Monitor] Initialized');
  }
  
  initDatabase() {
    const fs = require('fs');
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    this.db = new Database(DB_PATH);
    
    // Create tables
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
    `);
    
    console.log('[Agent Monitor] Database initialized');
  }

  reloadConfig() {
    STUCK_THRESHOLD = loadStuckThreshold();
    console.log('[Agent Monitor] Config reloaded: stuck threshold =', STUCK_THRESHOLD, 'seconds');
  }

  async getSessions() {
    try {
      const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}:#{session_activity}'], { timeout: 3000 });
      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, activity] = line.split(':');
        return { name, lastActivityEpoch: parseInt(activity, 10) || 0 };
      });
    } catch (err) {
      console.error('[Agent Monitor] Error listing tmux sessions:', err.message);
      return [];
    }
  }
  
  async captureTmuxPane(session, lines = 100) {
    try {
      const { stdout } = await execFileAsync('tmux', ['capture-pane', '-t', session, '-p', '-S', '-' + lines], { timeout: 3000 });
      return stdout;
    } catch (err) {
      console.error(`[Agent Monitor] Error capturing pane for ${session}:`, err.message);
      return '';
    }
  }
  
  detectState(output, lastState, idleTime) {
    // State detection based on Claude Code output patterns
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
    // Count visible indicators in current buffer
    const visibleIndicators = {
      filesRead: (output.match(/⏺ Read (\d+) files?/g) || []).length,
      filesWritten: (output.match(/⏺ Write\(/g) || []).length,
      filesEdited: (output.match(/⏺ Edit\(/g) || []).length,
      bashCommands: (output.match(/⏺ Bash\(/g) || []).length,
      contemplations: (output.match(/[✻✶] Contemplating/g) || []).length,
      errors: (output.match(/(Error:|✗|\[ERROR\])/g) || []).length,
    };
    
    // Get last seen counts for this session
    const lastSeen = this.lastSeenIndicators.get(session) || {
      filesRead: 0, filesWritten: 0, filesEdited: 0, bashCommands: 0, contemplations: 0
    };
    
    // Get cumulative counts
    const cumulative = this.cumulativeIndicators.get(session) || {
      filesRead: 0, filesWritten: 0, filesEdited: 0, bashCommands: 0, thinkingTime: 0, errors: 0
    };
    
    // Detect new activity (visible count increased since last check)
    const newReads = Math.max(0, visibleIndicators.filesRead - lastSeen.filesRead);
    const newWrites = Math.max(0, visibleIndicators.filesWritten - lastSeen.filesWritten);
    const newEdits = Math.max(0, visibleIndicators.filesEdited - lastSeen.filesEdited);
    const newBash = Math.max(0, visibleIndicators.bashCommands - lastSeen.bashCommands);
    
    // Add new activity to cumulative totals
    cumulative.filesRead += newReads;
    cumulative.filesWritten += newWrites;
    cumulative.filesEdited += newEdits;
    cumulative.bashCommands += newBash;
    cumulative.thinkingTime = this.extractThinkingTime(output);
    cumulative.errors = visibleIndicators.errors; // Errors don't accumulate, show current
    
    // Save state for next comparison
    this.lastSeenIndicators.set(session, { ...visibleIndicators });
    this.cumulativeIndicators.set(session, cumulative);
    
    // Simple progress calculation based on cumulative activity
    const completed = cumulative.filesWritten + cumulative.bashCommands;
    const estimated = 10; // Default estimate, should come from task spec
    const progress = Math.min(100, Math.round((completed / estimated) * 100));
    
    return { progress, indicators: cumulative };
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
  
  async monitorSession(session) {
    const output = await this.captureTmuxPane(session.name);
    if (!output) {
      // Session might be dead - check if tmux session still exists
      const liveSessions = await this.getSessions();
      const stillExists = liveSessions.some(s => s.name === session.name);
      
      if (!stillExists) {
        const prevState = this.currentState.get(session.name);
        if (prevState !== AgentState.COMPLETE) {
          console.log(`[Agent Monitor] ${session.name}: session gone → COMPLETE`);
          this.currentState.set(session.name, AgentState.COMPLETE);
          this.updateDatabase(session.name, AgentState.COMPLETE, 100, null, 'Session ended');
          this.emit('agent_complete', {
            session: session.name,
            output: 'Session no longer exists',
            timestamp: Date.now(),
          });
        }
      }
      return;
    }
    
    const hash = crypto.createHash('md5').update(output).digest('hex');
    const prevHash = this.lastHash.get(session.name);
    const now = Date.now();
    
    if (hash !== prevHash) {
      // Output changed
      this.lastHash.set(session.name, hash);
      this.lastActivity.set(session.name, now);
      
      const prevState = this.currentState.get(session.name);
      const newState = this.detectState(output, prevState, 0);
      
      if (newState !== prevState) {
        this.currentState.set(session.name, newState);
        console.log(`[Agent Monitor] ${session.name}: ${prevState || 'unknown'} → ${newState}`);
        
        // Parse progress
        const { progress, indicators } = this.parseProgress(output, session.name);
        this.progressData.set(session.name, { progress, indicators });
        
        // Update database
        this.updateDatabase(session.name, newState, progress, indicators, output.slice(-2000));
        
        // Emit state change event
        this.emit('state_change', {
          session: session.name,
          state: newState,
          prevState,
          progress,
          indicators,
          timestamp: now,
        });
        
        // Special events
        if (newState === AgentState.STUCK) {
          this.emit('agent_stuck', {
            session: session.name,
            idleTime: STUCK_THRESHOLD,
            output: output.slice(-1000),
            timestamp: now,
          });
        } else if (newState === AgentState.ERROR) {
          this.emit('agent_error', {
            session: session.name,
            output: output.slice(-1000),
            timestamp: now,
          });
        } else if (newState === AgentState.COMPLETE) {
          this.emit('agent_complete', {
            session: session.name,
            output: output.slice(-1000),
            timestamp: now,
          });
        }
      }
      
      // Always emit progress updates
      const { progress, indicators } = this.parseProgress(output, session.name);
      if (this.progressData.get(session.name)?.progress !== progress) {
        this.progressData.set(session.name, { progress, indicators });
        this.emit('progress', {
          session: session.name,
          progress,
          indicators,
          timestamp: now,
        });
      }
    } else {
      // No change, check idle time
      const lastAct = this.lastActivity.get(session.name) || now;
      const idleTime = (now - lastAct) / 1000;
      const currentState = this.currentState.get(session.name);
      
      if (idleTime > STUCK_THRESHOLD && currentState !== AgentState.STUCK) {
        this.currentState.set(session.name, AgentState.STUCK);
        console.log(`[Agent Monitor] ${session.name}: idle ${Math.round(idleTime)}s → STUCK`);
        
        this.updateDatabase(session.name, AgentState.STUCK, null, null, output.slice(-2000));
        
        this.emit('agent_stuck', {
          session: session.name,
          idleTime,
          output: output.slice(-1000),
          timestamp: now,
        });
      }
    }
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
        last_output = excluded.last_output,
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
  
  async start(targetSessions = []) {
    console.log('[Agent Monitor] Starting monitor...');
    
    if (targetSessions.length > 0) {
      this.sessions = targetSessions.map(name => ({ name }));
      console.log(`[Agent Monitor] Monitoring specific sessions: ${targetSessions.join(', ')}`);
    } else {
      console.log('[Agent Monitor] Auto-detecting sessions...');
    }
    
    setInterval(async () => {
      try {
        // Auto-detect sessions if not specified
        if (targetSessions.length === 0) {
          const allSessions = await this.getSessions();
          // Filter for Claude Code sessions (contain 'claude' or common patterns)
          this.sessions = allSessions.filter(s => 
            s.name.includes('relationship-os') ||
            s.name.includes('system-improvements') ||
            s.name.includes('claude') ||
            s.name.includes('omi')
          );
        }
        
        // Monitor each session
        for (const session of this.sessions) {
          await this.monitorSession(session);
        }
      } catch (err) {
        console.error('[Agent Monitor] Error in monitoring loop:', err);
      }
    }, POLL_INTERVAL);
    
    console.log(`[Agent Monitor] Monitoring ${this.sessions.length} sessions every ${POLL_INTERVAL}ms`);
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
}

// Export for use as module
module.exports = AgentMonitor;

// Run as standalone daemon if executed directly
if (require.main === module) {
  const monitor = new AgentMonitor();
  
  // Log events to console
  monitor.on('state_change', (data) => {
    console.log(`[Event] State change: ${data.session} → ${data.state} (${data.progress}%)`);
  });
  
  monitor.on('progress', (data) => {
    console.log(`[Event] Progress: ${data.session} → ${data.progress}% (files: ${data.indicators.filesWritten})`);
  });
  
  monitor.on('agent_stuck', (data) => {
    console.log(`[Event] Agent stuck: ${data.session} (idle ${Math.round(data.idleTime)}s)`);
  });
  
  monitor.on('agent_error', (data) => {
    console.log(`[Event] Agent error: ${data.session}`);
  });
  
  monitor.on('agent_complete', (data) => {
    console.log(`[Event] Agent complete: ${data.session}`);
  });
  
  // Start monitoring (auto-detect sessions)
  monitor.start();
  
  console.log('[Agent Monitor] Running in standalone mode. Press Ctrl+C to stop.');
}
