import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import SafetyController from '../src/safety.js';
import MemoryService from '../src/memory.js';
import ActionService from '../src/action.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__dirname, 'test-action.db');

test('ActionService - whitelist enforcement', async (t) => {
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

  await t.test('allows whitelisted actions', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    const result = await action.execute('alert', 'test message');
    assert.strictEqual(result.success, true);

    memory.close();
  });

  await t.test('blocks forbidden actions', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    const result = await action.execute('delete_important', 'some_file');
    assert.strictEqual(result.success, false);
    assert.match(result.reason, /forbidden/i);

    memory.close();
  });

  await t.test('blocks non-whitelisted actions', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    const result = await action.execute('unknown_action', 'target');
    assert.strictEqual(result.success, false);
    assert.match(result.reason, /not whitelisted/i);

    memory.close();
  });
});

test('ActionService - dry-run mode', async (t) => {
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

  await t.test('simulates actions in dry-run', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true); // dry-run = true

    const result = await action.execute('alert', 'test message');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.match(result.output, /dry-run/i);

    memory.close();
  });

  await t.test('executes actions in live mode', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, false); // dry-run = false

    const result = await action.execute('alert', 'test message');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, undefined);

    memory.close();
  });
});

test('ActionService - deduplication', async (t) => {
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

  await t.test('allows first action', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    const result = await action.execute('alert', 'message1');
    assert.strictEqual(result.success, true);

    memory.close();
  });

  await t.test('deduplicates repeated action', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    const result1 = await action.execute('alert', 'message1');
    assert.strictEqual(result1.success, true);

    const result2 = await action.execute('alert', 'message1');
    assert.strictEqual(result2.success, false);
    assert.match(result2.reason, /duplicate/i);

    memory.close();
  });

  await t.test('allows different targets', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    const result1 = await action.execute('alert', 'message1');
    const result2 = await action.execute('alert', 'message2');

    assert.strictEqual(result1.success, true);
    assert.strictEqual(result2.success, true);

    memory.close();
  });
});

test('ActionService - rate limiting', async (t) => {
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

  await t.test('respects action limits', async () => {
    const safety = new SafetyController();
    const memory = new MemoryService(TEST_DB);
    const action = new ActionService(safety, memory, true);

    // Clear deduplication to isolate rate limit test
    action.clearRecent();

    // Simulate hitting action limit
    for (let i = 0; i < 50; i++) {
      safety.recordAction('test');
    }

    const result = await action.execute('alert', 'message');
    assert.strictEqual(result.success, false);
    assert.match(result.reason, /limit/i);

    memory.close();
  });
});
