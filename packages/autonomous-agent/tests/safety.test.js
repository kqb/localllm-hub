import { test } from 'node:test';
import assert from 'node:assert';
import SafetyController from '../src/safety.js';

test('SafetyController - rate limiting', async (t) => {
  await t.test('allows API calls under limit', () => {
    const safety = new SafetyController();
    const check = safety.canMakeApiCall(1);
    assert.strictEqual(check.allowed, true);
  });

  await t.test('tracks API calls correctly', () => {
    const safety = new SafetyController();
    safety.recordApiCall(1, 0);
    safety.recordApiCall(2, 0.01);
    safety.recordApiCall(3, 1);

    const state = safety.getState();
    assert.strictEqual(state.api_calls_today, 3);
    assert.strictEqual(state.cost_today, 1.01);
  });

  await t.test('blocks when cost limit reached', () => {
    const safety = new SafetyController();

    // Simulate 30 expensive calls
    for (let i = 0; i < 30; i++) {
      safety.recordApiCall(3, 1);
    }

    // Try to make another expensive call (would push us over $30)
    const check = safety.canMakeApiCall(3);
    assert.strictEqual(check.allowed, false);
    assert.match(check.reason, /cost limit/i);
  });

  await t.test('blocks when API call limit reached', () => {
    const safety = new SafetyController();

    // Simulate 200 calls
    for (let i = 0; i < 200; i++) {
      safety.recordApiCall(1, 0);
    }

    const check = safety.canMakeApiCall(1);
    assert.strictEqual(check.allowed, false);
    assert.match(check.reason, /API call limit/i);
  });
});

test('SafetyController - circuit breaker', async (t) => {
  await t.test('trips after threshold failures', () => {
    const safety = new SafetyController();

    safety.recordFailure(new Error('fail 1'));
    safety.recordFailure(new Error('fail 2'));
    const result = safety.recordFailure(new Error('fail 3'));

    assert.strictEqual(result.circuit_breaker_open, true);
    assert.strictEqual(safety.getState().circuit_breaker_open, true);
  });

  await t.test('blocks all calls when open', () => {
    const safety = new SafetyController();

    safety.recordFailure(new Error('fail 1'));
    safety.recordFailure(new Error('fail 2'));
    safety.recordFailure(new Error('fail 3'));

    const apiCheck = safety.canMakeApiCall(1);
    const actionCheck = safety.canTakeAction('alert');

    assert.strictEqual(apiCheck.allowed, false);
    assert.strictEqual(actionCheck.allowed, false);
  });

  await t.test('resets on success', () => {
    const safety = new SafetyController();

    safety.recordFailure(new Error('fail 1'));
    safety.recordFailure(new Error('fail 2'));
    safety.recordSuccess();

    const state = safety.getState();
    assert.strictEqual(state.consecutive_failures, 0);
    assert.strictEqual(state.circuit_breaker_open, false);
  });

  await t.test('can be manually reset', () => {
    const safety = new SafetyController();

    safety.recordFailure(new Error('fail 1'));
    safety.recordFailure(new Error('fail 2'));
    safety.recordFailure(new Error('fail 3'));

    safety.resetCircuitBreaker();

    const state = safety.getState();
    assert.strictEqual(state.circuit_breaker_open, false);
    assert.strictEqual(state.consecutive_failures, 0);
  });
});

test('SafetyController - quiet hours', async (t) => {
  await t.test('detects quiet hours correctly', () => {
    const safety = new SafetyController();

    // Mock current time to 2am (in quiet hours)
    const originalDate = Date;
    global.Date = class extends Date {
      getHours() { return 2; }
      getMinutes() { return 0; }
    };

    assert.strictEqual(safety.isQuietHours(), true);

    // Mock to 10am (not quiet)
    global.Date = class extends Date {
      getHours() { return 10; }
      getMinutes() { return 0; }
    };

    assert.strictEqual(safety.isQuietHours(), false);

    global.Date = originalDate;
  });

  await t.test('blocks alerts during quiet hours', () => {
    const safety = new SafetyController();

    // Mock to quiet hours
    const originalDate = Date;
    global.Date = class extends Date {
      getHours() { return 2; }
      getMinutes() { return 0; }
    };

    const check = safety.canTakeAction('alert');
    assert.strictEqual(check.allowed, false);
    assert.match(check.reason, /quiet hours/i);

    global.Date = originalDate;
  });
});
