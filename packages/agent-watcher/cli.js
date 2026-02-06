#!/usr/bin/env node

/**
 * Agent Watcher CLI
 *
 * Command-line interface for managing the agent watcher daemon.
 */

const AgentWatcher = require('./watcher');

// Parse command line arguments
const [cmd, ...args] = process.argv.slice(2);

// Global watcher instance
let watcher = null;

const commands = {
  /**
   * Start the watcher daemon
   */
  async start() {
    watcher = new AgentWatcher();
    await watcher.start();
  },

  /**
   * Watch a specific session
   */
  async watch(sessionName) {
    if (!sessionName) {
      console.error('Usage: agent-watcher watch <session-name>');
      process.exit(1);
    }

    watcher = new AgentWatcher();
    await watcher.watchSession(sessionName);
    console.log(`Watching ${sessionName}. Press Ctrl+C to stop.`);

    // Keep process alive
    process.on('SIGINT', () => {
      watcher.stop();
    });
  },

  /**
   * Stop watching a specific session
   */
  async unwatch(sessionName) {
    if (!sessionName) {
      console.error('Usage: agent-watcher unwatch <session-name>');
      process.exit(1);
    }

    // This command is less useful since it requires a running watcher
    // But we'll implement it for completeness
    console.log('Note: This only works if a watcher daemon is already running.');
    console.log(`To stop watching ${sessionName}, use the dashboard or restart the watcher.`);
  },

  /**
   * List all watched sessions
   */
  async list() {
    watcher = new AgentWatcher();
    await watcher.scanSessions();
    const sessions = watcher.listSessions();

    if (sessions.length === 0) {
      console.log('No sessions being watched.');
    } else {
      console.log('Watched sessions:');
      sessions.forEach((s) => console.log(`  - ${s}`));
    }

    process.exit(0);
  },

  /**
   * Show status of all watched sessions
   */
  async status() {
    watcher = new AgentWatcher();
    await watcher.scanSessions();
    const statuses = watcher.getStatus();

    if (statuses.length === 0) {
      console.log('No sessions being watched.');
    } else {
      console.log('Session Status:');
      console.log('─'.repeat(80));
      statuses.forEach((s) => {
        const idleMin = Math.floor(s.idleMs / 60000);
        console.log(`${s.session}: ${s.state} (${s.progress}%) - idle ${idleMin}m`);
        if (s.recentSignals.length > 0) {
          console.log(`  Recent signals:`);
          s.recentSignals.forEach((sig) => {
            const time = new Date(sig.ts).toLocaleTimeString();
            console.log(`    [${time}] ${sig.type}: ${sig.payload || '(no payload)'}`);
          });
        }
        console.log('─'.repeat(80));
      });
    }

    process.exit(0);
  },

  /**
   * Show help
   */
  help() {
    console.log(`
Agent Watcher - Real-time monitoring for Claude Code agents

Usage:
  agent-watcher <command> [args]

Commands:
  start                   Start the watcher daemon (monitors all tmux sessions)
  watch <session>         Watch a specific tmux session
  unwatch <session>       Stop watching a session (requires running daemon)
  list                    List all watched sessions
  status                  Show status of all watched sessions
  help                    Show this help message

Examples:
  # Start the daemon
  agent-watcher start

  # Watch a specific session
  agent-watcher watch my-agent-session

  # Check status
  agent-watcher status

Signal Protocol:
  Agents can output these signals for real-time monitoring:
    :::DONE:::                    - Task complete
    :::DONE:summary:::            - Complete with summary
    :::HELP:question:::           - Need user input
    :::ERROR:message:::           - Hit an error
    :::BLOCKED:reason:::          - Blocked on something
    :::PROGRESS:50:::             - Progress update (0-100)

Configuration:
  Set environment variables to customize behavior:
    WATCHER_SCAN_INTERVAL=10000   - Session scan interval (ms)
    WATCHER_IDLE_THRESHOLD=300000 - Idle threshold (ms)
    WEBHOOK_ENABLED=false         - Disable webhooks for testing
`);
    process.exit(0);
  },
};

// Main
(async () => {
  if (!cmd || !commands[cmd]) {
    console.error(`Unknown command: ${cmd || '(none)'}`);
    console.error('Run "agent-watcher help" for usage information.');
    process.exit(1);
  }

  try {
    await commands[cmd](...args);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
