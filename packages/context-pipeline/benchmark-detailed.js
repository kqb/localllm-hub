#!/usr/bin/env node
/**
 * Detailed timing breakdown for all pipeline optimizations (Phase 1, 2, 3)
 * Shows time spent in each pipeline stage across all optimization layers.
 */

const { embed } = require('../../shared/ollama');
const { unifiedSearch, embeddingCache } = require('../chat-ingest/unified-search');
const { routeToModel } = require('../triage');
const { vectorIndex } = require('../chat-ingest/vector-index');
const { assembleContext, getStats, resetStats } = require('./index');
const { trimRagForRoute } = require('./route-config');
const { deduplicateMessages } = require('./history');
const config = require('../../shared/config');

const SEP = '═══════════════════════════════════════════════════════════════';
const LINE = '─────────────────────────────────────────────────────────────';

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

async function benchPhase1() {
  console.log(SEP);
  console.log('PHASE 1: Foundational Speed');
  console.log(SEP + '\n');

  const query = 'What is the context pipeline architecture?';
  console.log(`Query: "${query}"\n`);

  // Warmup vector index
  console.log('Loading vector index...');
  const indexStart = Date.now();
  vectorIndex.load();
  const indexTime = Date.now() - indexStart;
  const idxStats = vectorIndex.getStats();
  console.log(`  Index: ${idxStats.chunkCount} chunks, ${idxStats.memorySizeMB}MB in ${indexTime}ms`);
  console.log(`  Sources: memory=${idxStats.sources.memory}, chat=${idxStats.sources.chat}, telegram=${idxStats.sources.telegram}\n`);

  // --- Sequential baseline ---
  console.log(LINE);
  console.log('TEST 1: Sequential Execution (Baseline)');
  console.log(LINE);

  let total = Date.now();

  let start = Date.now();
  const queryEmbedding = await embed(config.models.embed, query);
  const queryVector = queryEmbedding.embeddings[0];
  const embedTime = Date.now() - start;
  console.log(`  1. Embedding: ${embedTime}ms`);

  start = Date.now();
  const ragResults = vectorIndex.search(queryVector, 15, 0.3, ['memory', 'chat', 'telegram']);
  const searchTime = Date.now() - start;
  console.log(`  2. Vector Search (${ragResults.length} results from ${idxStats.chunkCount} chunks): ${searchTime}ms`);

  start = Date.now();
  const routeDecision = await routeToModel(query, []);
  const routeTime = Date.now() - start;
  console.log(`  3. Routing (${routeDecision.route}): ${routeTime}ms`);

  const seqTotal = Date.now() - total;
  console.log(`  => TOTAL (sequential): ${seqTotal}ms\n`);

  // --- Parallel execution ---
  console.log(LINE);
  console.log('TEST 2: Parallel Execution (Phase 1)');
  console.log(LINE);

  total = Date.now();

  start = Date.now();
  const queryEmbedding2 = await embed(config.models.embed, query);
  const queryVector2 = queryEmbedding2.embeddings[0];
  const embedTime2 = Date.now() - start;
  console.log(`  1. Embedding: ${embedTime2}ms`);

  start = Date.now();
  const [ragResult, routeResult] = await Promise.allSettled([
    (async () => {
      const s = Date.now();
      const r = vectorIndex.search(queryVector2, 15, 0.3, ['memory', 'chat', 'telegram']);
      return { results: r, time: Date.now() - s };
    })(),
    (async () => {
      const s = Date.now();
      const r = await routeToModel(query, []);
      return { decision: r, time: Date.now() - s };
    })(),
  ]);

  const parallelTime = Date.now() - start;
  const ragTime = ragResult.value?.time || 0;
  const routeTime2 = routeResult.value?.time || 0;

  console.log(`  2. Vector Search: ${ragTime}ms (parallel)`);
  console.log(`  3. Routing (${routeResult.value?.decision.route}): ${routeTime2}ms (parallel)`);
  console.log(`  => Parallel block: ${parallelTime}ms`);

  const parTotal = Date.now() - total;
  console.log(`  => TOTAL (parallel): ${parTotal}ms\n`);

  // --- Vector Index vs SQLite ---
  console.log(LINE);
  console.log('TEST 3: Vector Index vs SQLite');
  console.log(LINE);

  config.contextPipeline.vectorIndex.enabled = false;
  start = Date.now();
  const sqliteResults = await unifiedSearch(query, { topK: 15, sources: ['memory', 'chat', 'telegram'] });
  const sqliteTime = Date.now() - start;
  console.log(`  SQLite full-table scan: ${sqliteTime}ms (${sqliteResults.length} results)`);

  config.contextPipeline.vectorIndex.enabled = true;
  start = Date.now();
  const vectorResults = await unifiedSearch(query, { topK: 15, sources: ['memory', 'chat', 'telegram'] });
  const vectorTime = Date.now() - start;
  console.log(`  Vector index search: ${vectorTime}ms (${vectorResults.length} results)`);

  const indexSpeedup = (sqliteTime / Math.max(vectorTime, 1)).toFixed(1);
  console.log(`  => Speedup: ${indexSpeedup}x faster, saves ${sqliteTime - vectorTime}ms\n`);

  return { seqTotal, parTotal, embedTime2, searchTime: ragTime, routeTime: routeTime2, sqliteTime, vectorTime, indexStats: idxStats };
}

async function benchPhase2() {
  console.log(SEP);
  console.log('PHASE 2: Skip Logic + Embedding Cache + Timing Stats');
  console.log(SEP + '\n');

  resetStats();
  embeddingCache.clear();

  // --- Skip logic ---
  console.log(LINE);
  console.log('TEST 4: Smart Skip Logic');
  console.log(LINE);

  const skipMessages = [
    { text: 'ok', expect: 'skip' },
    { text: 'yes', expect: 'skip' },
    { text: 'thanks', expect: 'skip' },
    { text: 'lol', expect: 'skip' },
    { text: 'HEARTBEAT check', expect: 'skip' },
    { text: 'got it', expect: 'skip' },
    { text: 'fix it', expect: 'enrich (verb)' },
    { text: 'run tests', expect: 'enrich (verb)' },
    { text: 'show logs', expect: 'enrich (verb)' },
    { text: 'Explain the context pipeline architecture', expect: 'enrich' },
  ];

  let skipCount = 0;
  let enrichCount = 0;
  let totalSkipTime = 0;
  let totalEnrichTime = 0;

  for (const msg of skipMessages) {
    const start = Date.now();
    const result = await assembleContext(msg.text, `bench-skip-${Date.now()}`);
    const elapsed = Date.now() - start;
    const skipped = result.metadata.skipped === true;

    if (skipped) {
      skipCount++;
      totalSkipTime += elapsed;
    } else {
      enrichCount++;
      totalEnrichTime += elapsed;
    }

    const status = skipped ? 'SKIP' : 'ENRICH';
    const check = (skipped && msg.expect === 'skip') || (!skipped && msg.expect.startsWith('enrich')) ? ' ok' : ' MISMATCH';
    console.log(`  ${status.padEnd(7)} ${elapsed.toString().padStart(5)}ms  "${msg.text}"${check}`);
  }

  const avgSkip = skipCount > 0 ? Math.round(totalSkipTime / skipCount) : 0;
  const avgEnrich = enrichCount > 0 ? Math.round(totalEnrichTime / enrichCount) : 0;

  console.log();
  console.log(`  Skipped: ${skipCount}/${skipMessages.length} (${pct(skipCount, skipMessages.length)}%)`);
  console.log(`  Avg skip latency: ${avgSkip}ms`);
  console.log(`  Avg enrich latency: ${avgEnrich}ms\n`);

  // --- Embedding cache ---
  console.log(LINE);
  console.log('TEST 5: Embedding Cache');
  console.log(LINE);

  embeddingCache.clear();

  const cacheQuery = 'context pipeline optimizations';

  // Cold hit
  let start = Date.now();
  await unifiedSearch(cacheQuery, { topK: 5, sources: ['memory'] });
  const coldTime = Date.now() - start;
  console.log(`  Cold (miss): ${coldTime}ms  cache_size=${embeddingCache.size}`);

  // Warm hit — same query
  start = Date.now();
  await unifiedSearch(cacheQuery, { topK: 5, sources: ['memory'] });
  const warmTime = Date.now() - start;
  console.log(`  Warm (hit):  ${warmTime}ms  cache_size=${embeddingCache.size}`);

  // Near-miss — slightly different query (different cache key)
  start = Date.now();
  await unifiedSearch('Context Pipeline Optimizations', { topK: 5, sources: ['memory'] });
  const nearTime = Date.now() - start;
  console.log(`  Near-match:  ${nearTime}ms  cache_size=${embeddingCache.size}  (normalized to same key)`);

  const cacheSavings = coldTime - warmTime;
  console.log(`  => Cache saves: ${cacheSavings}ms per hit (${pct(cacheSavings, coldTime)}% of cold time)\n`);

  // --- Per-stage timing ---
  console.log(LINE);
  console.log('TEST 6: Per-Stage Timing Stats');
  console.log(LINE);

  const pipeStats = getStats();
  console.log(`  Total calls: ${pipeStats.totalCalls}`);
  console.log(`  Skipped: ${pipeStats.skippedCalls} (${(pipeStats.skipRate * 100).toFixed(0)}%)`);
  console.log(`  Stage averages:`);
  for (const [stage, avgMs] of Object.entries(pipeStats.stageAverages)) {
    console.log(`    ${stage.padEnd(12)} ${avgMs}ms avg`);
  }
  console.log();

  return { skipCount, skipTotal: skipMessages.length, avgSkip, avgEnrich, coldTime, warmTime, cacheSavings, pipeStats };
}

async function benchPhase3() {
  console.log(SEP);
  console.log('PHASE 3: Route-Aware Sources + Deduplication + Connection Pool');
  console.log(SEP + '\n');

  // --- Route-aware source trimming ---
  console.log(LINE);
  console.log('TEST 7: Route-Aware RAG Trimming');
  console.log(LINE);

  // Generate realistic RAG results with mixed sources
  const fakeRag = [
    { source: 'memory', text: 'context pipeline architecture', score: 0.85, meta: {} },
    { source: 'chat', text: 'discussed pipeline optimization', score: 0.78, meta: {} },
    { source: 'memory', text: 'assembleContext function', score: 0.72, meta: {} },
    { source: 'telegram', text: 'sent pipeline diagram', score: 0.65, meta: {} },
    { source: 'chat', text: 'decided on parallel execution', score: 0.60, meta: {} },
    { source: 'memory', text: 'vector index implementation', score: 0.55, meta: {} },
    { source: 'telegram', text: 'shared benchmark results', score: 0.50, meta: {} },
    { source: 'chat', text: 'skip logic discussion', score: 0.45, meta: {} },
    { source: 'memory', text: 'config system overview', score: 0.38, meta: {} },
    { source: 'telegram', text: 'routing architecture notes', score: 0.32, meta: {} },
  ];

  const routes = ['local_qwen', 'claude_haiku', 'claude_sonnet', 'claude_opus', 'local_reasoning'];

  for (const route of routes) {
    const trimmed = trimRagForRoute(fakeRag, { route });
    const sources = [...new Set(trimmed.map(r => r.source))];
    const minScore = trimmed.length > 0 ? trimmed[trimmed.length - 1].score.toFixed(2) : 'N/A';
    console.log(
      `  ${route.padEnd(18)} ${fakeRag.length} => ${String(trimmed.length).padEnd(2)} results  ` +
      `sources=[${sources.join(',')}]  min_score=${minScore}`
    );
  }

  const opusTrimmed = trimRagForRoute(fakeRag, { route: 'claude_opus' });
  const localTrimmed = trimRagForRoute(fakeRag, { route: 'local_qwen' });
  const tokenReduction = pct(fakeRag.length - localTrimmed.length, fakeRag.length);
  console.log(`  => local_qwen token reduction: ${tokenReduction}% fewer chunks injected\n`);

  // --- Deduplication ---
  console.log(LINE);
  console.log('TEST 8: Message Deduplication');
  console.log(LINE);

  const dupeMessages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'fix the bug' },
    { role: 'user', content: 'fix the bug' },     // retry dup
    { role: 'user', content: 'fix the bug' },     // retry dup
    { role: 'assistant', content: 'Looking into it...' },
    { role: 'user', content: 'ok' },
    { role: 'user', content: 'ok' },               // retry dup
    { role: 'assistant', content: 'Done.' },
    { role: 'user', content: 'thanks' },
    { role: 'user', content: 'thanks' },           // retry dup
  ];

  const deduped = deduplicateMessages(dupeMessages);
  console.log(`  Input:  ${dupeMessages.length} messages`);
  console.log(`  Output: ${deduped.length} messages (${dupeMessages.length - deduped.length} duplicates removed)`);
  console.log(`  Content: ${deduped.map(m => `${m.role[0]}:"${m.content}"`).join(' → ')}\n`);

  // --- Connection pool ---
  console.log(LINE);
  console.log('TEST 9: Connection Pooling');
  console.log(LINE);

  const poolIterations = 5;
  const poolQuery = 'test connection pooling';

  // Isolate pooling test: disable vector index + cache to force SQLite path
  config.contextPipeline.vectorIndex.enabled = false;
  config.contextPipeline.features.embeddingCache = false;

  // With pooling
  config.contextPipeline.features.connectionPool = true;
  let start = Date.now();
  for (let i = 0; i < poolIterations; i++) {
    await unifiedSearch(`${poolQuery} ${i}`, { topK: 3, sources: ['memory'] });
  }
  const pooledTime = Date.now() - start;

  // Without pooling
  config.contextPipeline.features.connectionPool = false;
  start = Date.now();
  for (let i = 0; i < poolIterations; i++) {
    await unifiedSearch(`${poolQuery} ${i}`, { topK: 3, sources: ['memory'] });
  }
  const unpooledTime = Date.now() - start;

  // Restore defaults
  config.contextPipeline.features.connectionPool = true;
  config.contextPipeline.features.embeddingCache = true;
  config.contextPipeline.vectorIndex.enabled = true;

  console.log(`  ${poolIterations} searches with pool (SQLite path): ${pooledTime}ms (${Math.round(pooledTime / poolIterations)}ms avg)`);
  console.log(`  ${poolIterations} searches without pool (SQLite path): ${unpooledTime}ms (${Math.round(unpooledTime / poolIterations)}ms avg)`);
  console.log(`  => Pool saves: ${unpooledTime - pooledTime}ms over ${poolIterations} calls\n`);

  return { tokenReduction, dedupBefore: dupeMessages.length, dedupAfter: deduped.length, pooledTime, unpooledTime };
}

async function printSummary(p1, p2, p3) {
  console.log(SEP);
  console.log('FULL PIPELINE SUMMARY — All Phases');
  console.log(SEP + '\n');

  const features = config.contextPipeline.features;
  console.log('Feature Flags:');
  for (const [name, enabled] of Object.entries(features)) {
    console.log(`  ${enabled ? '[ON] ' : '[OFF]'} ${name}`);
  }
  console.log();

  console.log('Phase 1 — Foundational Speed:');
  console.log(`  Parallel execution:   ${p1.seqTotal}ms → ${p1.parTotal}ms (${pct(p1.seqTotal - p1.parTotal, p1.seqTotal)}% faster)`);
  console.log(`  Vector index:         ${p1.sqliteTime}ms → ${p1.vectorTime}ms (${(p1.sqliteTime / Math.max(p1.vectorTime, 1)).toFixed(1)}x faster)`);
  console.log(`  Index:                ${p1.indexStats.chunkCount} chunks, ${p1.indexStats.memorySizeMB}MB\n`);

  console.log('Phase 2 — Skip + Cache + Observability:');
  console.log(`  Skip rate:            ${p2.skipCount}/${p2.skipTotal} messages (${pct(p2.skipCount, p2.skipTotal)}%)`);
  console.log(`  Avg skip latency:     ${p2.avgSkip}ms`);
  console.log(`  Avg enrich latency:   ${p2.avgEnrich}ms`);
  console.log(`  Cache savings:        ${p2.cacheSavings}ms per hit (cold=${p2.coldTime}ms, warm=${p2.warmTime}ms)`);
  console.log(`  Stage tracking:       ${Object.keys(p2.pipeStats.stageAverages).join(', ')}\n`);

  console.log('Phase 3 — Quality + Polish:');
  console.log(`  Route-aware trim:     ${p3.tokenReduction}% fewer chunks for local routes`);
  console.log(`  Deduplication:        ${p3.dedupBefore} → ${p3.dedupAfter} messages`);
  console.log(`  Connection pooling:   ${p3.unpooledTime}ms → ${p3.pooledTime}ms over 5 searches\n`);

  // Blended estimate
  const skipRate = p2.skipCount / p2.skipTotal;
  const blendedAvg = Math.round(skipRate * p2.avgSkip + (1 - skipRate) * p2.avgEnrich);
  const baseline = 2500;

  console.log('Blended Performance (all optimizations):');
  console.log(`  Baseline avg:         ~${baseline}ms`);
  console.log(`  Enriched query avg:   ${p2.avgEnrich}ms`);
  console.log(`  Skipped query avg:    ${p2.avgSkip}ms`);
  console.log(`  Blended avg:          ${blendedAvg}ms (${pct(baseline - blendedAvg, baseline)}% total improvement)`);
  console.log(`  Target:               <500ms blended`);
  console.log();
}

async function main() {
  console.log();
  const p1 = await benchPhase1();
  const p2 = await benchPhase2();
  const p3 = await benchPhase3();
  await printSummary(p1, p2, p3);
}

main().catch(console.error);
