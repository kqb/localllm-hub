/**
 * Session State Tests
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { SessionState, States } = require('../session-state');

test('initializes with correct defaults', () => {
  const state = new SessionState('test-session');
  assert.strictEqual(state.session, 'test-session');
  assert.strictEqual(state.state, States.SPAWNED);
  assert.strictEqual(state.progress, 0);
  assert.strictEqual(state.history.length, 0);
});

test('handles PROGRESS signal', (t, done) => {
  const state = new SessionState('test');

  state.on('progress', (progress) => {
    assert.strictEqual(progress, 50);
    assert.strictEqual(state.state, States.WORKING);
    assert.strictEqual(state.progress, 50);
    done();
  });

  state.handleSignal({ type: 'PROGRESS', payload: '50' });
});

test('handles DONE signal', (t, done) => {
  const state = new SessionState('test');

  state.on('complete', (payload) => {
    assert.strictEqual(payload, 'Task finished');
    assert.strictEqual(state.state, States.DONE);
    assert.strictEqual(state.progress, 100);
    done();
  });

  state.handleSignal({ type: 'DONE', payload: 'Task finished' });
});

test('handles HELP signal', (t, done) => {
  const state = new SessionState('test');

  state.on('need_input', (payload) => {
    assert.strictEqual(payload, 'Which database?');
    assert.strictEqual(state.state, States.WAITING_INPUT);
    done();
  });

  state.handleSignal({ type: 'HELP', payload: 'Which database?' });
});

test('handles ERROR signal', (t, done) => {
  const state = new SessionState('test');

  state.on('error', (payload) => {
    assert.strictEqual(payload, 'Build failed');
    assert.strictEqual(state.state, States.ERROR);
    done();
  });

  state.handleSignal({ type: 'ERROR', payload: 'Build failed' });
});

test('handles BLOCKED signal', (t, done) => {
  const state = new SessionState('test');

  state.on('blocked', (payload) => {
    assert.strictEqual(payload, 'Need API key');
    assert.strictEqual(state.state, States.WAITING_INPUT);
    done();
  });

  state.handleSignal({ type: 'BLOCKED', payload: 'Need API key' });
});

test('maintains signal history', () => {
  const state = new SessionState('test');

  state.handleSignal({ type: 'PROGRESS', payload: '25' });
  state.handleSignal({ type: 'PROGRESS', payload: '50' });
  state.handleSignal({ type: 'DONE', payload: 'Complete' });

  assert.strictEqual(state.history.length, 3);
  assert.strictEqual(state.history[0].type, 'PROGRESS');
  assert.strictEqual(state.history[1].type, 'PROGRESS');
  assert.strictEqual(state.history[2].type, 'DONE');
});

test('limits history size', () => {
  const state = new SessionState('test');
  state.maxHistory = 5;

  // Add 10 signals
  for (let i = 0; i < 10; i++) {
    state.handleSignal({ type: 'PROGRESS', payload: String(i * 10) });
  }

  // Should only keep last 5
  assert.strictEqual(state.history.length, 5);
  assert.strictEqual(state.history[0].payload, '50');
  assert.strictEqual(state.history[4].payload, '90');
});

test('isIdle returns false for recent activity', () => {
  const state = new SessionState('test');
  state.handleSignal({ type: 'PROGRESS', payload: '50' });
  assert.strictEqual(state.isIdle(1000), false);
});

test('isIdle returns true for old activity', () => {
  const state = new SessionState('test');
  state.lastActivity = Date.now() - 400000; // 400 seconds ago
  assert.strictEqual(state.isIdle(300000), true); // 300 second threshold
});

test('getRecentHistory returns limited signals', () => {
  const state = new SessionState('test');

  for (let i = 0; i < 10; i++) {
    state.handleSignal({ type: 'PROGRESS', payload: String(i) });
  }

  const recent = state.getRecentHistory(3);
  assert.strictEqual(recent.length, 3);
  assert.strictEqual(recent[0].payload, '7');
  assert.strictEqual(recent[2].payload, '9');
});

test('toJSON returns serializable state', () => {
  const state = new SessionState('test');
  state.handleSignal({ type: 'PROGRESS', payload: '75' });

  const json = state.toJSON();
  assert.strictEqual(json.session, 'test');
  assert.strictEqual(json.state, States.WORKING);
  assert.strictEqual(json.progress, 75);
  assert.ok(json.lastActivity);
  assert.ok(json.idleMs >= 0);
  assert.ok(Array.isArray(json.recentSignals));
});
