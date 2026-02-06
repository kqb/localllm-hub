/**
 * Persistence Layer Tests
 *
 * Tests JSONL logging, state loading, and history retrieval.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Persistence = require('../persistence');

// Use a temp file for testing
const TEST_LOG = '/tmp/agent-watcher-test.jsonl';

describe('Persistence', () => {
  let persistence;

  before(() => {
    // Clean up any existing test file
    if (fs.existsSync(TEST_LOG)) {
      fs.unlinkSync(TEST_LOG);
    }
    persistence = new Persistence(TEST_LOG);
  });

  after(() => {
    // Clean up
    persistence.close();
    if (fs.existsSync(TEST_LOG)) {
      fs.unlinkSync(TEST_LOG);
    }
  });

  test('logSignal() writes JSONL entries', async () => {
    const signal = {
      type: 'PROGRESS',
      payload: '50',
      ts: Date.now(),
    };

    persistence.logSignal('test-session', signal);

    // Give it a moment to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(fs.existsSync(TEST_LOG), 'Log file should exist');
    const content = fs.readFileSync(TEST_LOG, 'utf-8');
    assert.ok(content.length > 0, 'Log file should have content');
    assert.ok(content.includes('"type":"PROGRESS"'), 'Should contain signal type');
    assert.ok(content.includes('"session":"test-session"'), 'Should contain session name');
  });

  test('logSignal() handles signals without timestamps', async () => {
    const signal = {
      type: 'DONE',
      payload: 'Task complete',
    };

    persistence.logSignal('test-session-2', signal);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const content = fs.readFileSync(TEST_LOG, 'utf-8');
    const lines = content.trim().split('\n');
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    assert.ok(lastEntry.ts, 'Should add timestamp if missing');
    assert.strictEqual(lastEntry.type, 'DONE');
  });

  test('loadSessionState() reconstructs state from history', async () => {
    // Log a sequence of signals
    const signals = [
      { type: 'PROGRESS', payload: '25', ts: Date.now() },
      { type: 'PROGRESS', payload: '50', ts: Date.now() + 1000 },
      { type: 'PROGRESS', payload: '75', ts: Date.now() + 2000 },
    ];

    for (const sig of signals) {
      persistence.logSignal('restore-test', sig);
    }

    // Give it time to write
    await new Promise((resolve) => setTimeout(resolve, 200));

    const state = await persistence.loadSessionState('restore-test');

    assert.strictEqual(state.state, 'working', 'Should restore state to "working"');
    assert.strictEqual(state.progress, 75, 'Should restore progress to last value');
    assert.strictEqual(state.history.length, 3, 'Should restore all 3 signals');
  });

  test('loadSessionState() handles DONE signals', async () => {
    persistence.logSignal('done-test', {
      type: 'DONE',
      payload: 'All done',
      ts: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const state = await persistence.loadSessionState('done-test');

    assert.strictEqual(state.state, 'done', 'Should restore state to "done"');
    assert.strictEqual(state.progress, 100, 'Should set progress to 100');
  });

  test('loadSessionState() handles ERROR signals', async () => {
    persistence.logSignal('error-test', {
      type: 'ERROR',
      payload: 'Something broke',
      ts: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const state = await persistence.loadSessionState('error-test');

    assert.strictEqual(state.state, 'error', 'Should restore state to "error"');
  });

  test('loadSessionState() returns empty state for non-existent session', async () => {
    const state = await persistence.loadSessionState('does-not-exist');

    assert.strictEqual(state.state, 'spawned', 'Should default to "spawned"');
    assert.strictEqual(state.progress, 0, 'Should default progress to 0');
    assert.strictEqual(state.history.length, 0, 'Should have empty history');
  });

  test('getHistory() returns session-specific history', async () => {
    // Log signals for multiple sessions
    persistence.logSignal('session-a', { type: 'PROGRESS', payload: '10', ts: Date.now() });
    persistence.logSignal('session-b', { type: 'PROGRESS', payload: '20', ts: Date.now() });
    persistence.logSignal('session-a', { type: 'PROGRESS', payload: '30', ts: Date.now() });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const historyA = await persistence.getHistory('session-a');
    const historyB = await persistence.getHistory('session-b');

    // Filter out signals from other tests
    const filteredA = historyA.filter((e) => e.session === 'session-a');
    const filteredB = historyB.filter((e) => e.session === 'session-b');

    assert.ok(filteredA.length >= 2, 'Session A should have at least 2 signals');
    assert.ok(filteredB.length >= 1, 'Session B should have at least 1 signal');
  });

  test('getHistory() respects limit parameter', async () => {
    // Log many signals
    for (let i = 0; i < 60; i++) {
      persistence.logSignal('limit-test', {
        type: 'PROGRESS',
        payload: String(i),
        ts: Date.now() + i,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 300));

    const history = await persistence.getHistory('limit-test', 10);

    assert.ok(history.length <= 10, 'Should respect limit of 10');
    // Should return most recent entries
    const lastEntry = history[history.length - 1];
    assert.strictEqual(lastEntry.payload, '59', 'Should return most recent signals');
  });

  test('getRecentActivity() returns recent signals across all sessions', async () => {
    const now = Date.now();

    // Log recent signals
    persistence.logSignal('recent-1', { type: 'DONE', payload: '', ts: now });
    persistence.logSignal('recent-2', { type: 'DONE', payload: '', ts: now });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const recent = await persistence.getRecentActivity(60); // Last 60 minutes

    const recentCount = recent.filter(
      (e) => e.session === 'recent-1' || e.session === 'recent-2'
    ).length;

    assert.ok(recentCount >= 2, 'Should find at least 2 recent signals');
  });

  test('getRecentActivity() filters by time window', async () => {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    // Log old signal (should not appear in 1-minute window)
    persistence.logSignal('old-session', {
      type: 'PROGRESS',
      payload: '10',
      ts: twoHoursAgo,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const recent = await persistence.getRecentActivity(1); // Last 1 minute

    const oldSignals = recent.filter((e) => e.session === 'old-session');
    assert.strictEqual(oldSignals.length, 0, 'Should not include signals older than window');
  });
});
