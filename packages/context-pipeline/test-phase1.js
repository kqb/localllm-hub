#!/usr/bin/env node
/**
 * Phase 1 Optimization Verification Test
 * Tests parallel execution and vector index performance
 */

const { assembleContext, getStats, resetStats } = require('./index');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

// Test queries
const QUERIES = [
  { text: 'What is the context pipeline architecture?', label: 'complex-query' },
  { text: 'How do we handle routing decisions?', label: 'medium-query' },
  { text: 'Find notes about vector embeddings', label: 'simple-query' },
];

async function runTest() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       Phase 1 Context Pipeline Optimization Test              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  • Parallel Execution: ${config.contextPipeline.parallelExecution ? '✓ ENABLED' : '✗ disabled'}`);
  console.log(`  • Vector Index: ${config.contextPipeline.vectorIndex.enabled ? '✓ ENABLED' : '✗ disabled'}`);
  console.log(`  • Vector Index Stale After: ${config.contextPipeline.vectorIndex.staleAfterMs}ms`);
  console.log(`  • RAG Top-K: ${config.contextPipeline.rag.topK}`);
  console.log(`  • RAG Min Score: ${config.contextPipeline.rag.minScore}\n`);

  // Warmup run to initialize vector index
  console.log('Warming up vector index...');
  await assembleContext('warmup query', 'test-warmup');
  console.log('✓ Warmup complete\n');

  resetStats();

  console.log('Running benchmark queries...\n');
  const results = [];

  for (const query of QUERIES) {
    console.log(`Testing: "${query.text}"`);
    console.log(`Label: ${query.label}`);

    const iterations = 3;
    const times = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const result = await assembleContext(query.text, `bench-${query.label}-${i}`);
      const elapsed = Date.now() - start;
      times.push(elapsed);

      console.log(`  Run ${i + 1}: ${elapsed}ms (RAG: ${result.ragContext.length} results, Route: ${result.routeDecision.route})`);
    }

    const avg = Math.round(times.reduce((a, b) => a + b) / times.length);
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`  ✓ Average: ${avg}ms (min: ${min}ms, max: ${max}ms)\n`);

    results.push({
      query: query.label,
      avg,
      min,
      max,
      times,
    });
  }

  // Print summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const stats = getStats();
  console.log('Pipeline Statistics:');
  console.log(`  • Total Calls: ${stats.totalCalls}`);
  console.log(`  • Average Assembly Time: ${Math.round(stats.avgAssemblyTime)}ms`);
  console.log(`  • Active Sessions: ${stats.activeSessions}`);
  console.log(`  • Total Messages: ${stats.totalMessages}\n`);

  console.log('Per-Query Results:');
  results.forEach(r => {
    console.log(`  ${r.query}: avg=${r.avg}ms, min=${r.min}ms, max=${r.max}ms`);
  });

  const overallAvg = Math.round(results.reduce((sum, r) => sum + r.avg, 0) / results.length);
  console.log(`\n  Overall Average: ${overallAvg}ms\n`);

  console.log('Expected Performance (from optimization doc):');
  console.log('  • Sequential (baseline): ~2500ms avg');
  console.log('  • Phase 1 target: ~600-900ms avg');
  console.log('  • Improvement: 65-76% reduction\n');

  if (overallAvg < 1000) {
    console.log('✓ SUCCESS: Performance meets Phase 1 targets!');
  } else if (overallAvg < 1500) {
    console.log('⚠ PARTIAL: Performance improved but not meeting full target');
  } else {
    console.log('✗ ISSUE: Performance not meeting Phase 1 expectations');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');

  // Test fallback behavior
  console.log('\nTesting fallback behavior...');
  console.log('(Temporarily disabling vector index)\n');

  const originalConfig = config.contextPipeline.vectorIndex.enabled;
  config.contextPipeline.vectorIndex.enabled = false;

  const fallbackStart = Date.now();
  const fallbackResult = await assembleContext('fallback test query', 'test-fallback');
  const fallbackTime = Date.now() - fallbackStart;

  console.log(`  Fallback mode (SQLite): ${fallbackTime}ms`);
  console.log(`  Fallback RAG results: ${fallbackResult.ragContext.length}`);

  config.contextPipeline.vectorIndex.enabled = originalConfig;

  const fastStart = Date.now();
  const fastResult = await assembleContext('fallback test query', 'test-fast');
  const fastTime = Date.now() - fastStart;

  console.log(`  Vector index mode: ${fastTime}ms`);
  console.log(`  Fast RAG results: ${fastResult.ragContext.length}`);
  console.log(`  Speedup: ${(fallbackTime / fastTime).toFixed(1)}x faster\n`);

  console.log('✓ Test complete!');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
