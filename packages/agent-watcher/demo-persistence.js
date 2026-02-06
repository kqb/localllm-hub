#!/usr/bin/env node

/**
 * Demo: Persistence and Reconnect
 *
 * Shows how the watcher persists signals and reconnects to sessions after restart.
 */

const Persistence = require('./persistence');
const { SessionState } = require('./session-state');

const DEMO_LOG = '/tmp/agent-watcher-demo.jsonl';

async function demo() {
  console.log('='.repeat(80));
  console.log('Agent Watcher Persistence Demo');
  console.log('='.repeat(80));
  console.log();

  // Clean up from previous runs
  const fs = require('fs');
  if (fs.existsSync(DEMO_LOG)) {
    fs.unlinkSync(DEMO_LOG);
  }

  const persistence = new Persistence(DEMO_LOG);

  // Simulate agent session
  console.log('📝 Simulating agent session: build-feature-auth');
  console.log();

  const signals = [
    { type: 'PROGRESS', payload: '25', ts: Date.now() },
    { type: 'PROGRESS', payload: '50', ts: Date.now() + 1000 },
    { type: 'HELP', payload: 'Use JWT or sessions?', ts: Date.now() + 2000 },
  ];

  for (const signal of signals) {
    console.log(`  → Signal: ${signal.type} ${signal.payload}`);
    persistence.logSignal('build-feature-auth', signal);
  }

  console.log();
  console.log('⏸️  Simulating watcher restart...');
  console.log();

  // Wait for writes to flush
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Simulate restart - load saved state
  const savedState = await persistence.loadSessionState('build-feature-auth');

  console.log('🔄 Restored state from persistence:');
  console.log(`   State: ${savedState.state}`);
  console.log(`   Progress: ${savedState.progress}%`);
  console.log(`   History entries: ${savedState.history.length}`);
  console.log();

  // Create session state from saved data
  const session = new SessionState('build-feature-auth', savedState);

  console.log('📊 Reconstructed session:');
  console.log(JSON.stringify(session.toJSON(), null, 2));
  console.log();

  // Show history file
  console.log('📄 JSONL log file:');
  const content = fs.readFileSync(DEMO_LOG, 'utf-8');
  content
    .trim()
    .split('\n')
    .forEach((line) => {
      console.log(`   ${line}`);
    });
  console.log();

  // Get recent activity
  console.log('🕐 Recent activity (last 60 minutes):');
  const recent = await persistence.getRecentActivity(60);
  console.log(`   ${recent.length} signals across all sessions`);
  console.log();

  persistence.close();

  console.log('✅ Demo complete!');
  console.log();
  console.log('Key takeaways:');
  console.log('  1. Signals are persisted to JSONL immediately');
  console.log('  2. State is reconstructed by replaying signal history');
  console.log('  3. Watcher can reconnect to sessions after restart');
  console.log('  4. No data loss even if watcher crashes');
  console.log();
}

demo().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
