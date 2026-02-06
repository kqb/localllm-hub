import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import SafetyController from '../src/safety.js';
import MemoryService from '../src/memory.js';
import ObservationService from '../src/observation.js';
import ReasoningService from '../src/reasoning.js';
import ActionService from '../src/action.js';
import ControlService from '../src/control.js';
import ConsciousnessLoop from '../src/loop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__dirname, 'test-integration.db');

test('Integration - full system', async (t) => {
  t.beforeEach(() => {
    if (existsSync(TEST_DB)) {
      rmSync(TEST_DB);
    }
  });

  t.afterEach(() => {
    if (existsSync(TEST_DB)) {
      rmSync(TEST_DB);
    }
  });

  await t.test('services initialize correctly', () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const observation = new ObservationService(memory);
    const reasoning = new ReasoningService(safety, memory);
    const action = new ActionService(safety, memory, true);
    const loop = new ConsciousnessLoop(
      observation,
      reasoning,
      action,
      memory,
      safety,
      null
    );
    const control = new ControlService(loop, safety, memory);

    assert.ok(safety);
    assert.ok(memory);
    assert.ok(observation);
    assert.ok(reasoning);
    assert.ok(action);
    assert.ok(loop);
    assert.ok(control);

    memory.close();
  });

  await t.test('can observe environment', async () => {
    const memory = new MemoryService(TEST_DB);
    const observation = new ObservationService(memory);

    const result = await observation.observe();

    assert.ok(result.timestamp);
    assert.ok(Array.isArray(result.events));
    assert.ok(result.summary);
    assert.ok(result.summary.total !== undefined);

    await observation.stop();
    memory.close();
  });

  await t.test('memory persists state', () => {
    const memory = new MemoryService(TEST_DB);

    memory.setWorkingMemory('test_key', { value: 'test_data' });
    const retrieved = memory.getWorkingMemory('test_key');

    assert.deepStrictEqual(retrieved, { value: 'test_data' });

    memory.logThought(1, 1, 'test reasoning', 'test decision', 0);
    const thoughts = memory.getRecentThoughts(1);

    assert.strictEqual(thoughts.length, 1);
    assert.strictEqual(thoughts[0].reasoning, 'test reasoning');

    memory.close();
  });

  await t.test('action logs are recorded', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    await action.execute('alert', 'test message');

    const actions = memory.getRecentActions(1);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].action_type, 'alert');
    assert.strictEqual(actions[0].target, 'test message');

    memory.close();
  });

  await t.test('cost tracking works end-to-end', () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);

    // Simulate some API calls
    safety.recordApiCall(1, 0);
    safety.recordApiCall(2, 0.01);
    safety.recordApiCall(3, 1);

    // Log thoughts with costs
    memory.logThought(1, 1, 'tier 1', 'ignore', 0);
    memory.logThought(2, 2, 'tier 2', 'alert', 0.01);
    memory.logThought(3, 3, 'tier 3', 'escalate', 1);

    const stats = memory.getCostStats();
    assert.strictEqual(stats.thought_cost, 1.01);

    const safetyState = safety.getState();
    assert.strictEqual(safetyState.cost_today, 1.01);

    memory.close();
  });

  await t.test('control service manages lifecycle', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const observation = new ObservationService(memory);
    const reasoning = new ReasoningService(safety, memory);
    const action = new ActionService(safety, memory, true);
    const loop = new ConsciousnessLoop(
      observation,
      reasoning,
      action,
      memory,
      safety,
      null
    );
    const control = new ControlService(loop, safety, memory);
    loop.control = control;

    const status1 = control.getStatus();
    assert.strictEqual(status1.status, 'stopped');

    // Note: Not actually starting loop to avoid async test complications
    // Just verify control logic

    const health = await control.healthCheck();
    assert.ok(health.status);
    assert.ok(health.checks);

    await observation.stop();
    memory.close();
  });
});

test('Integration - safety interlock', async (t) => {
  t.beforeEach(() => {
    if (existsSync(TEST_DB)) {
      rmSync(TEST_DB);
    }
  });

  t.afterEach(() => {
    if (existsSync(TEST_DB)) {
      rmSync(TEST_DB);
    }
  });

  await t.test('circuit breaker stops actions', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    // Trip circuit breaker
    safety.recordFailure(new Error('fail 1'));
    safety.recordFailure(new Error('fail 2'));
    safety.recordFailure(new Error('fail 3'));

    // Try to execute action
    const result = await action.execute('alert', 'test');

    assert.strictEqual(result.success, false);
    assert.match(result.reason, /circuit breaker/i);

    memory.close();
  });

  await t.test('cost limit stops reasoning', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const reasoning = new ReasoningService(safety, memory);

    // Hit cost limit
    for (let i = 0; i < 30; i++) {
      safety.recordApiCall(3, 1);
    }

    const result = await reasoning.tier1Triage({ type: 'test', data: {} });

    assert.strictEqual(result.important, false);
    assert.match(result.reason, /cost limit/i);

    memory.close();
  });
});
