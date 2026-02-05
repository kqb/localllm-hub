"use strict";

/**
 * Memory Tracker Module
 *
 * Tracks memory recall failures and user corrections to diagnose
 * patterns where the agent fails to retrieve or act on known information.
 *
 * Data stored in:
 * - data/memory-misses.jsonl: Individual miss events
 * - data/memory-metrics.json: Aggregated daily metrics
 * - data/corrections-log.jsonl: User correction events
 */

const { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");
const logger = require("../../shared/logger");

// Data paths
const DATA_DIR = join(__dirname, "../../data");
const MISSES_PATH = join(DATA_DIR, "memory-misses.jsonl");
const METRICS_PATH = join(DATA_DIR, "memory-metrics.json");
const CORRECTIONS_PATH = join(DATA_DIR, "corrections-log.jsonl");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================================
// CORRECTION SIGNAL DETECTION
// Patterns indicating user is correcting the agent's memory recall
// ============================================================================

const CORRECTION_SIGNALS = [
  // Direct corrections
  /you should (have|know|remember)/i,
  /we (did|built|have|made) (this|that)/i,
  /wrong (project|file|location|approach)/i,
  /not that (one|file|project)/i,
  /already have/i,
  /you keep (forgetting|missing)/i,
  /why (can't|couldn't|didn't) you (find|remember|recall)/i,
  /that's not (right|correct|what I meant)/i,
  /I (said|mentioned|told you)/i,

  // Frustration signals (memory-related)
  /how many times/i,
  /we've been (through|over) this/i,
  /I already (told|explained|showed)/i,
  /check (the|my|our) (memory|notes|history)/i,

  // Redirect signals
  /look at the/i,
  /it's in (the|my|our)/i,
  /should be in/i,
  /as (I|we) (established|discussed|documented)/i,
];

// Categorization patterns for misses
const MISS_CATEGORIES = {
  project_reference: [
    /project/i, /repo/i, /codebase/i, /repository/i,
  ],
  file_location: [
    /file/i, /path/i, /directory/i, /folder/i, /location/i,
  ],
  established_workflow: [
    /workflow/i, /pipeline/i, /process/i, /procedure/i, /how (to|we)/i,
  ],
  configuration: [
    /config/i, /setting/i, /parameter/i, /option/i,
  ],
  identity_context: [
    /my name/i, /who am I/i, /what do I/i, /about me/i,
  ],
  recent_conversation: [
    /just (said|mentioned|told)/i, /earlier/i, /few (minutes|messages) ago/i,
  ],
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Detect if a user message indicates a correction signal.
 * @param {string} message - User message to check
 * @returns {{isCorrection: boolean, signals: string[], severity: string}}
 */
function detectCorrectionSignal(message) {
  const matched = [];

  for (const pattern of CORRECTION_SIGNALS) {
    if (pattern.test(message)) {
      const match = message.match(pattern);
      matched.push(match ? match[0] : pattern.toString());
    }
  }

  if (matched.length === 0) {
    return { isCorrection: false, signals: [], severity: "none" };
  }

  // Determine severity based on pattern types
  const frustrationPatterns = [
    /how many times/i,
    /we've been/i,
    /you keep/i,
    /why (can't|couldn't|didn't)/i,
  ];

  const hasFrustration = frustrationPatterns.some(p => p.test(message));

  return {
    isCorrection: true,
    signals: matched,
    severity: hasFrustration ? "high" : matched.length > 1 ? "medium" : "low",
  };
}

/**
 * Categorize a memory miss based on the query and context.
 * @param {string} query - Original user query
 * @param {string} correction - User's correction message (if any)
 * @returns {string} Category name
 */
function categorizeMiss(query, correction = "") {
  const text = `${query} ${correction}`.toLowerCase();

  for (const [category, patterns] of Object.entries(MISS_CATEGORIES)) {
    if (patterns.some(p => p.test(text))) {
      return category;
    }
  }

  return "other";
}

/**
 * Log a memory miss event.
 * @param {object} data - Miss data
 * @param {string} data.query - Original user query
 * @param {string} [data.expected] - What the agent should have known
 * @param {string} [data.actual] - What the agent responded with
 * @param {string} [data.correction] - User's correction message
 * @param {number} [data.ragScore] - RAG relevance score at time of query
 * @param {string} [data.route] - Model route used
 * @param {number} [data.herdingCount] - Number of correction messages before success
 */
function logMemoryMiss(data) {
  const entry = {
    timestamp: new Date().toISOString(),
    query: data.query,
    expectedKnowledge: data.expected || null,
    actualResponse: data.actual ? data.actual.substring(0, 500) : null,
    correction: data.correction || null,
    category: categorizeMiss(data.query, data.correction),
    ragScoreAtTime: data.ragScore || 0,
    routeAtTime: data.route || "unknown",
    herdingMessages: data.herdingCount || 0,
  };

  try {
    appendFileSync(MISSES_PATH, JSON.stringify(entry) + "\n");
    logger.warn(`Memory miss logged: ${entry.category} - "${data.query.substring(0, 50)}..."`);
    updateMetrics(entry);
  } catch (err) {
    logger.error(`Failed to log memory miss: ${err.message}`);
  }

  return entry;
}

/**
 * Log a user correction event.
 * @param {object} data - Correction data
 */
function logCorrection(data) {
  const correctionInfo = detectCorrectionSignal(data.message);

  const entry = {
    timestamp: new Date().toISOString(),
    message: data.message,
    signals: correctionInfo.signals,
    severity: correctionInfo.severity,
    previousQuery: data.previousQuery || null,
    previousResponse: data.previousResponse ? data.previousResponse.substring(0, 300) : null,
    ragScore: data.ragScore || 0,
    route: data.route || "unknown",
    sessionId: data.sessionId || null,
  };

  try {
    appendFileSync(CORRECTIONS_PATH, JSON.stringify(entry) + "\n");
    logger.info(`Correction logged: severity=${entry.severity}`);
  } catch (err) {
    logger.error(`Failed to log correction: ${err.message}`);
  }

  return entry;
}

/**
 * Update aggregated metrics.
 * @param {object} missEntry - Memory miss entry
 */
function updateMetrics(missEntry) {
  let metrics = loadMetrics();
  const today = missEntry.timestamp.split("T")[0];

  if (!metrics.daily[today]) {
    metrics.daily[today] = {
      totalQueries: 0,
      memoryMisses: 0,
      manualOverrides: 0,
      totalHerdingMessages: 0,
      avgRAGScore: 0,
      ragScoreSum: 0,
      categories: {},
    };
  }

  const dayMetrics = metrics.daily[today];
  dayMetrics.memoryMisses++;
  dayMetrics.totalHerdingMessages += missEntry.herdingMessages || 0;
  dayMetrics.ragScoreSum += missEntry.ragScoreAtTime || 0;
  dayMetrics.avgRAGScore = dayMetrics.ragScoreSum / dayMetrics.memoryMisses;

  // Track by category
  const cat = missEntry.category || "other";
  dayMetrics.categories[cat] = (dayMetrics.categories[cat] || 0) + 1;

  saveMetrics(metrics);
}

/**
 * Increment a daily metric counter.
 * @param {string} metric - Metric name (totalQueries, manualOverrides, etc.)
 * @param {number} [amount=1] - Amount to increment
 */
function incrementMetric(metric, amount = 1) {
  const metrics = loadMetrics();
  const today = new Date().toISOString().split("T")[0];

  if (!metrics.daily[today]) {
    metrics.daily[today] = {
      totalQueries: 0,
      memoryMisses: 0,
      manualOverrides: 0,
      totalHerdingMessages: 0,
      avgRAGScore: 0,
      ragScoreSum: 0,
      categories: {},
    };
  }

  metrics.daily[today][metric] = (metrics.daily[today][metric] || 0) + amount;
  saveMetrics(metrics);
}

/**
 * Load metrics from file.
 * @returns {object} Metrics data
 */
function loadMetrics() {
  try {
    if (existsSync(METRICS_PATH)) {
      return JSON.parse(readFileSync(METRICS_PATH, "utf-8"));
    }
  } catch (err) {
    logger.error(`Failed to load metrics: ${err.message}`);
  }

  return {
    initialized: new Date().toISOString(),
    daily: {},
  };
}

/**
 * Save metrics to file.
 * @param {object} metrics - Metrics data
 */
function saveMetrics(metrics) {
  try {
    writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
  } catch (err) {
    logger.error(`Failed to save metrics: ${err.message}`);
  }
}

/**
 * Get metrics summary for dashboard.
 * @param {number} [days=7] - Number of days to include
 * @returns {object} Metrics summary
 */
function getMetricsSummary(days = 7) {
  const metrics = loadMetrics();
  const now = new Date();
  const summary = {
    totalRecalls: 0,
    totalMisses: 0,
    missRate: 0,
    avgRAGScore: 0,
    herdingAvg: 0,
    topCategories: [],
    daily: [],
    trend: "stable",
  };

  const categoryTotals = {};
  let ragScoreSum = 0;
  let herdingSum = 0;
  let queryCount = 0;

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const dayData = metrics.daily[dateStr];

    if (dayData) {
      summary.totalRecalls += dayData.totalQueries || 0;
      summary.totalMisses += dayData.memoryMisses || 0;
      ragScoreSum += dayData.ragScoreSum || 0;
      herdingSum += dayData.totalHerdingMessages || 0;
      queryCount += dayData.memoryMisses || 0;

      // Aggregate categories
      for (const [cat, count] of Object.entries(dayData.categories || {})) {
        categoryTotals[cat] = (categoryTotals[cat] || 0) + count;
      }

      summary.daily.push({
        date: dateStr,
        queries: dayData.totalQueries || 0,
        misses: dayData.memoryMisses || 0,
        overrides: dayData.manualOverrides || 0,
      });
    } else {
      summary.daily.push({ date: dateStr, queries: 0, misses: 0, overrides: 0 });
    }
  }

  // Calculate averages
  if (summary.totalRecalls > 0) {
    summary.missRate = summary.totalMisses / summary.totalRecalls;
  }
  if (queryCount > 0) {
    summary.avgRAGScore = ragScoreSum / queryCount;
    summary.herdingAvg = herdingSum / queryCount;
  }

  // Top categories
  summary.topCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  // Determine trend (compare last 3 days to previous 4 days)
  const recentMisses = summary.daily.slice(0, 3).reduce((s, d) => s + d.misses, 0);
  const olderMisses = summary.daily.slice(3, 7).reduce((s, d) => s + d.misses, 0);
  if (recentMisses < olderMisses * 0.7) {
    summary.trend = "improving";
  } else if (recentMisses > olderMisses * 1.3) {
    summary.trend = "declining";
  }

  return summary;
}

/**
 * Get recent corrections for dashboard display.
 * @param {number} [limit=10] - Max corrections to return
 * @returns {Array} Recent corrections
 */
function getRecentCorrections(limit = 10) {
  try {
    if (!existsSync(CORRECTIONS_PATH)) {
      return [];
    }

    const lines = readFileSync(CORRECTIONS_PATH, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);

    return lines
      .slice(-limit)
      .reverse()
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    logger.error(`Failed to read corrections: ${err.message}`);
    return [];
  }
}

/**
 * Get recent memory misses for dashboard display.
 * @param {number} [limit=10] - Max misses to return
 * @returns {Array} Recent misses
 */
function getRecentMisses(limit = 10) {
  try {
    if (!existsSync(MISSES_PATH)) {
      return [];
    }

    const lines = readFileSync(MISSES_PATH, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);

    return lines
      .slice(-limit)
      .reverse()
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    logger.error(`Failed to read misses: ${err.message}`);
    return [];
  }
}

module.exports = {
  // Detection
  detectCorrectionSignal,
  categorizeMiss,
  // Logging
  logMemoryMiss,
  logCorrection,
  // Metrics
  loadMetrics,
  saveMetrics,
  incrementMetric,
  getMetricsSummary,
  // Dashboard helpers
  getRecentCorrections,
  getRecentMisses,
  // Constants
  CORRECTION_SIGNALS,
  MISS_CATEGORIES,
};
