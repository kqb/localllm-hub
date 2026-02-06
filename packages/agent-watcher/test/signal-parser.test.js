/**
 * Signal Parser Tests
 */

const { test } = require('node:test');
const assert = require('node:assert');
const SignalParser = require('../signal-parser');

test('parses DONE signal without payload', () => {
  const result = SignalParser.parse('Some output :::DONE::: more text');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'DONE');
  assert.strictEqual(result[0].payload, '');
});

test('parses DONE signal with payload', () => {
  const result = SignalParser.parse(':::DONE:Built 5 components:::');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'DONE');
  assert.strictEqual(result[0].payload, 'Built 5 components');
});

test('parses HELP signal', () => {
  const result = SignalParser.parse(':::HELP:Should I use Redis or Postgres?:::');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'HELP');
  assert.strictEqual(result[0].payload, 'Should I use Redis or Postgres?');
});

test('parses ERROR signal', () => {
  const result = SignalParser.parse(':::ERROR:npm install failed:::');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'ERROR');
  assert.strictEqual(result[0].payload, 'npm install failed');
});

test('parses BLOCKED signal', () => {
  const result = SignalParser.parse(':::BLOCKED:Need API key:::');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'BLOCKED');
  assert.strictEqual(result[0].payload, 'Need API key');
});

test('parses PROGRESS signal', () => {
  const result = SignalParser.parse(':::PROGRESS:50:::');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'PROGRESS');
  assert.strictEqual(result[0].payload, '50');
});

test('parses multiple signals', () => {
  const text = 'Starting... :::PROGRESS:25::: working... :::PROGRESS:50::: :::DONE:Complete:::';
  const result = SignalParser.parse(text);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].type, 'PROGRESS');
  assert.strictEqual(result[0].payload, '25');
  assert.strictEqual(result[1].type, 'PROGRESS');
  assert.strictEqual(result[1].payload, '50');
  assert.strictEqual(result[2].type, 'DONE');
  assert.strictEqual(result[2].payload, 'Complete');
});

test('returns empty array for no signals', () => {
  const result = SignalParser.parse('Just regular output with no signals');
  assert.strictEqual(result.length, 0);
});

test('handles empty string', () => {
  const result = SignalParser.parse('');
  assert.strictEqual(result.length, 0);
});

test('handles null/undefined', () => {
  assert.strictEqual(SignalParser.parse(null).length, 0);
  assert.strictEqual(SignalParser.parse(undefined).length, 0);
});

test('hasSignals returns true when signals present', () => {
  assert.strictEqual(SignalParser.hasSignals(':::DONE:::'), true);
  assert.strictEqual(SignalParser.hasSignals('text :::HELP:question::: more'), true);
});

test('hasSignals returns false when no signals', () => {
  assert.strictEqual(SignalParser.hasSignals('no signals here'), false);
  assert.strictEqual(SignalParser.hasSignals(''), false);
  assert.strictEqual(SignalParser.hasSignals(null), false);
});
