#!/usr/bin/env node
/**
 * Detailed timing breakdown for Phase 1 optimizations
 * Shows time spent in each pipeline stage
 */

const { embed } = require('../../shared/ollama');
const { unifiedSearch } = require('../chat-ingest/unified-search');
const { routeToModel } = require('../triage');
const { vectorIndex } = require('../chat-ingest/vector-index');
const config = require('../../shared/config');

async function detailedBenchmark() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DETAILED PHASE 1 TIMING BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const query = 'What is the context pipeline architecture?';
  console.log(`Query: "${query}"\n`);

  // Warmup vector index
  console.log('Loading vector index...');
  const indexStart = Date.now();
  vectorIndex.load();
  const indexTime = Date.now() - indexStart;
  const stats = vectorIndex.getStats();
  console.log(`✓ Index loaded: ${stats.chunkCount} chunks, ${stats.memorySizeMB}MB in ${indexTime}ms`);
  console.log(`  Sources: memory=${stats.sources.memory}, chat=${stats.sources.chat}, telegram=${stats.sources.telegram}\n`);

  // Test 1: Sequential baseline (Phase 0)
  console.log('─────────────────────────────────────────────────────────────');
  console.log('TEST 1: Sequential Execution (Baseline)');
  console.log('─────────────────────────────────────────────────────────────');

  let total = Date.now();

  // Step 1: Embedding
  let start = Date.now();
  const queryEmbedding = await embed(config.models.embed, query);
  const queryVector = queryEmbedding.embeddings[0];
  const embedTime = Date.now() - start;
  console.log(`  1. Embedding: ${embedTime}ms`);

  // Step 2: Vector search
  start = Date.now();
  const ragResults = vectorIndex.search(queryVector, 15, 0.3, ['memory', 'chat', 'telegram']);
  const searchTime = Date.now() - start;
  console.log(`  2. Vector Search (15 results from ${stats.chunkCount} chunks): ${searchTime}ms`);

  // Step 3: Routing (sequential - after RAG)
  start = Date.now();
  const routeDecision = await routeToModel(query, []);
  const routeTime = Date.now() - start;
  console.log(`  3. Routing (${routeDecision.route}): ${routeTime}ms`);

  const seqTotal = Date.now() - total;
  console.log(`  ➜ TOTAL (sequential): ${seqTotal}ms\n`);

  // Test 2: Parallel execution (Phase 1)
  console.log('─────────────────────────────────────────────────────────────');
  console.log('TEST 2: Parallel Execution (Phase 1 Optimization)');
  console.log('─────────────────────────────────────────────────────────────');

  total = Date.now();

  // Step 1: Embedding (still required)
  start = Date.now();
  const queryEmbedding2 = await embed(config.models.embed, query);
  const queryVector2 = queryEmbedding2.embeddings[0];
  const embedTime2 = Date.now() - start;
  console.log(`  1. Embedding: ${embedTime2}ms`);

  // Step 2 & 3: Parallel RAG + Routing
  start = Date.now();
  const [ragResult, routeResult] = await Promise.allSettled([
    (async () => {
      const s = Date.now();
      const r = vectorIndex.search(queryVector2, 15, 0.3, ['memory', 'chat', 'telegram']);
      const t = Date.now() - s;
      return { results: r, time: t };
    })(),
    (async () => {
      const s = Date.now();
      const r = await routeToModel(query, []);
      const t = Date.now() - s;
      return { decision: r, time: t };
    })(),
  ]);

  const parallelTime = Date.now() - start;
  const ragTime = ragResult.value?.time || 0;
  const routeTime2 = routeResult.value?.time || 0;

  console.log(`  2. Vector Search: ${ragTime}ms (parallel)`);
  console.log(`  3. Routing (${routeResult.value?.decision.route}): ${routeTime2}ms (parallel)`);
  console.log(`  ➜ Parallel block: ${parallelTime}ms (max of both)`);

  const parTotal = Date.now() - total;
  console.log(`  ➜ TOTAL (parallel): ${parTotal}ms\n`);

  // Comparison
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PERFORMANCE COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const savings = seqTotal - parTotal;
  const savingsPct = Math.round((savings / seqTotal) * 100);

  console.log('Breakdown:');
  console.log(`  Sequential: embed(${embedTime}ms) → search(${searchTime}ms) → route(${routeTime}ms) = ${seqTotal}ms`);
  console.log(`  Parallel:   embed(${embedTime2}ms) → max(search(${ragTime}ms), route(${routeTime2}ms)) = ${parTotal}ms`);
  console.log();
  console.log(`  Time saved by parallelization: ${savings}ms (${savingsPct}%)`);
  console.log(`  Speedup: ${(seqTotal / parTotal).toFixed(2)}x faster\n`);

  // Vector Index Benefit
  console.log('─────────────────────────────────────────────────────────────');
  console.log('TEST 3: Vector Index Benefit (vs SQLite)');
  console.log('─────────────────────────────────────────────────────────────');

  // Disable vector index to test SQLite fallback
  config.contextPipeline.vectorIndex.enabled = false;

  start = Date.now();
  const sqliteResults = await unifiedSearch(query, { topK: 15, sources: ['memory', 'chat', 'telegram'] });
  const sqliteTime = Date.now() - start;
  console.log(`  SQLite full-table scan: ${sqliteTime}ms (${sqliteResults.length} results)`);

  // Re-enable vector index
  config.contextPipeline.vectorIndex.enabled = true;

  start = Date.now();
  const vectorResults = await unifiedSearch(query, { topK: 15, sources: ['memory', 'chat', 'telegram'] });
  const vectorTime = Date.now() - start;
  console.log(`  Vector index search: ${vectorTime}ms (${vectorResults.length} results)`);

  const indexSavings = sqliteTime - vectorTime;
  const indexSpeedup = (sqliteTime / vectorTime).toFixed(1);
  console.log(`  ➜ Speedup: ${indexSpeedup}x faster, saves ${indexSavings}ms\n`);

  // Final summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 1 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('✓ Optimization 1: Parallel RAG + Routing');
  console.log(`    Saves: ${savings}ms per query (${savingsPct}% reduction)`);
  console.log(`    Expected: ~400-800ms (routing latency eliminated)`);
  console.log();

  console.log('✓ Optimization 2: In-Memory Vector Index');
  console.log(`    Saves: ${indexSavings}ms per query`);
  console.log(`    Speedup: ${indexSpeedup}x faster than SQLite`);
  console.log(`    Index size: ${stats.chunkCount} chunks (${stats.memorySizeMB}MB in RAM)`);
  console.log();

  const baseline = 2500; // From optimization doc
  const current = parTotal;
  const improvement = Math.round((1 - current / baseline) * 100);

  console.log(`Overall Performance:`);
  console.log(`  Baseline (sequential + SQLite): ~${baseline}ms`);
  console.log(`  Current (Phase 1 optimized): ${current}ms`);
  console.log(`  Improvement: ${improvement}% faster\n`);

  console.log('Notes:');
  console.log(`  • Dataset is 16x larger than expected (${stats.chunkCount} vs 390 chunks)`);
  console.log(`  • topK is 15 (config.local.json override) vs optimal 5`);
  console.log(`  • Query embedding cache (Phase 2) would save ~${embedTime2}ms on cache hits`);
  console.log(`  • Smart skip logic (Phase 2) would eliminate enrichment for simple messages`);
  console.log();
}

detailedBenchmark().catch(console.error);
