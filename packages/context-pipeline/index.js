const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { deepMerge } = require('../../shared/utils');
const { unifiedSearch } = require('../chat-ingest/unified-search');
const { routeToModel } = require('../triage');
const { trimRagForRoute } = require('./route-config');
const { compressHistory, deduplicateMessages } = require('./history');

// In-memory session storage with LRU eviction
const sessions = new Map();
const MAX_SESSIONS = 100; // Prevent unbounded growth
const MAX_MESSAGES_PER_SESSION = 1000; // Cap messages per session

// Stats tracking
const stats = {
  totalCalls: 0,
  skippedCalls: 0,        // Optimization #5: Smart Skip Logic
  avgAssemblyTime: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastReset: new Date().toISOString(),
  stages: {               // Optimization #8: Per-Stage Timing Stats
    embedding: { totalMs: 0, count: 0 },
    search: { totalMs: 0, count: 0 },
    routing: { totalMs: 0, count: 0 },
    assembly: { totalMs: 0, count: 0 },
  },
};

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    // LRU eviction: if at max capacity, remove oldest session
    if (sessions.size >= MAX_SESSIONS) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, session] of sessions.entries()) {
        const time = new Date(session.lastActive).getTime();
        if (time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        logger.debug(`Evicting oldest session: ${oldestKey}`);
        sessions.delete(oldestKey);
      }
    }

    sessions.set(sessionId, {
      id: sessionId,
      messages: [],
      systemNotes: [],
      created: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    });
  }
  const session = sessions.get(sessionId);
  session.lastActive = new Date().toISOString();
  return session;
}

function addMessageToSession(sessionId, message) {
  const session = getSession(sessionId);
  session.messages.push({
    ...message,
    timestamp: new Date().toISOString(),
  });

  // Cap messages per session to prevent unbounded growth
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    const excess = session.messages.length - MAX_MESSAGES_PER_SESSION;
    logger.debug(`Trimming ${excess} old messages from session ${sessionId}`);
    session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
  }

  return session;
}

function addSystemNote(sessionId, note) {
  const session = getSession(sessionId);
  session.systemNotes.push({
    note,
    timestamp: new Date().toISOString(),
  });

  // Limit system notes to maxNotes
  const maxNotes = config.contextPipeline?.systemNotes?.maxNotes || 10;
  if (session.systemNotes.length > maxNotes) {
    session.systemNotes = session.systemNotes.slice(-maxNotes);
  }
}

function estimateTokens(text) {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function truncateHistory(messages, maxMessages, maxTokens) {
  let result = messages.slice(-maxMessages);
  let totalTokens = result.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(text);
  }, 0);

  // If still over budget, trim from the front
  while (totalTokens > maxTokens && result.length > 1) {
    const removed = result.shift();
    const text = typeof removed.content === 'string' ? removed.content : JSON.stringify(removed.content);
    totalTokens -= estimateTokens(text);
  }

  return result;
}

// ============================================================================
// Optimization #8: Per-Stage Timing Stats
// ============================================================================

/**
 * Record timing for a pipeline stage
 */
function recordStage(name, ms) {
  const s = stats.stages[name];
  if (s) { s.totalMs += ms; s.count++; }
}

// ============================================================================
// Optimization #5: Smart Skip Logic
// ============================================================================

const SKIP_PATTERNS = [
  /^(ok|yes|no|sure|thanks?|ty|k|got it|done|np|yep|nope|lol|haha)$/i,
  /^HEARTBEAT/,
  /^System:/,
  /^\[media attached:.*\]$/,
];
const SKIP_MAX_LENGTH = 15;

/**
 * Determine if a message should skip expensive enrichment (RAG + routing)
 */
function shouldSkipEnrichment(messageText) {
  if (messageText.length <= SKIP_MAX_LENGTH) {
    const hasVerb = /\b(fix|run|show|find|search|list|get|set|add|remove|delete|update|create|explain|describe)\b/i;
    if (!hasVerb.test(messageText)) return true;
  }
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(messageText.trim())) return true;
  }
  return false;
}

/**
 * Assemble context for a message by gathering:
 * - Short-term conversation history
 * - RAG context from unified search
 * - Routing decision
 * - System notes
 *
 * @param {string|object} message - User message (string or message object)
 * @param {string} sessionId - Session identifier
 * @param {object} [options] - Override config options
 * @returns {Promise<object>} Assembled context
 */
async function assembleContext(message, sessionId, options = {}) {
  const startTime = Date.now();
  stats.totalCalls++;

  const pipelineConfig = deepMerge(config.contextPipeline, options);

  // Normalize message
  const userMessage = typeof message === 'string'
    ? { role: 'user', content: message }
    : message;

  const messageText = typeof userMessage.content === 'string'
    ? userMessage.content
    : JSON.stringify(userMessage.content);

  // Optimization #5: Skip enrichment for simple messages
  const skipEnabled = pipelineConfig.features?.skipLogic !== false;
  if (skipEnabled && shouldSkipEnrichment(messageText)) {
    stats.skippedCalls++;
    const assemblyTime = Date.now() - startTime;

    const result = {
      shortTermHistory: [],
      ragContext: [],
      routeDecision: {
        route: pipelineConfig.routing?.fallback || 'claude_sonnet',
        reason: 'skipped (simple message)',
        priority: 'low',
      },
      systemNotes: [],
      assembledPrompt: [userMessage],
      metadata: {
        sessionId,
        assemblyTime,
        skipped: true,
        config: pipelineConfig,
      },
    };

    logger.debug(`Skipped enrichment for simple message: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`);
    return result;
  }

  const result = {
    shortTermHistory: [],
    ragContext: [],
    routeDecision: null,
    systemNotes: [],
    assembledPrompt: [],
    metadata: {
      sessionId,
      assemblyTime: 0,
      config: pipelineConfig,
    },
  };

  // 1. Short-term history
  if (pipelineConfig.shortTerm?.enabled) {
    const session = getSession(sessionId);
    const maxMessages = pipelineConfig.shortTerm.maxMessages || 20;
    const maxTokens = pipelineConfig.shortTerm.maxTokenEstimate || 8000;

    // Deduplicate consecutive identical messages before truncation
    const dedupedMessages = deduplicateMessages(session.messages);

    // Use history compression if enabled (Optimization #7), otherwise hard truncate
    if (pipelineConfig.features?.historyCompression) {
      result.shortTermHistory = await compressHistory(dedupedMessages, maxMessages, maxTokens);
    } else {
      result.shortTermHistory = truncateHistory(dedupedMessages, maxMessages, maxTokens);
    }

    logger.debug(`Loaded ${result.shortTermHistory.length} messages from history`);
  }

  // 2. RAG context + 3. Routing decision (parallel execution)
  // These operations are independent - routing only needs message text + recent history,
  // not RAG results. Running in parallel saves ~400-800ms (routing latency).
  const useParallel = pipelineConfig.parallelExecution !== false;

  if (useParallel) {
    const [ragResult, routeResult] = await Promise.allSettled([
      // RAG search
      pipelineConfig.rag?.enabled
        ? (async () => {
            const ragStart = Date.now();
            const topK = pipelineConfig.rag.topK || 5;
            const minScore = pipelineConfig.rag.minScore || 0.3;
            const sources = pipelineConfig.rag.sources || ['memory', 'chat', 'telegram'];

            const searchResults = await unifiedSearch(messageText, { topK, sources });
            const filtered = searchResults.filter(r => r.score >= minScore);
            const ragTime = Date.now() - ragStart;

            recordStage('search', ragTime); // Optimization #8
            logger.debug(`RAG: ${filtered.length}/${searchResults.length} results (${ragTime}ms)`);
            return filtered;
          })()
        : Promise.resolve([]),

      // Routing decision
      pipelineConfig.routing?.enabled
        ? (async () => {
            const routeStart = Date.now();
            const recentHistory = result.shortTermHistory.slice(-2);
            const decision = await routeToModel(messageText, recentHistory);
            const routeTime = Date.now() - routeStart;

            recordStage('routing', routeTime); // Optimization #8
            logger.debug(`Route: ${decision.route} (${routeTime}ms)`);
            return decision;
          })()
        : Promise.resolve(null),
    ]);

    // Extract RAG results
    if (ragResult.status === 'fulfilled') {
      result.ragContext = ragResult.value;
    } else {
      logger.error(`RAG search failed: ${ragResult.reason?.message || ragResult.reason}`);
      result.ragContext = [];
    }

    // Extract routing decision
    if (routeResult.status === 'fulfilled' && routeResult.value) {
      result.routeDecision = routeResult.value;
    } else {
      const errorMsg = routeResult.status === 'rejected'
        ? `Routing error: ${routeResult.reason?.message || routeResult.reason}`
        : 'Routing disabled';

      result.routeDecision = {
        route: pipelineConfig.routing?.fallback || 'claude_sonnet',
        reason: errorMsg,
        priority: 'medium',
      };
      if (routeResult.status === 'rejected') {
        logger.error(errorMsg);
      }
    }
  } else {
    // Sequential fallback (original behavior)
    // 2. RAG context
    if (pipelineConfig.rag?.enabled) {
      try {
        const ragStart = Date.now(); // Optimization #8
        const topK = pipelineConfig.rag.topK || 5;
        const minScore = pipelineConfig.rag.minScore || 0.3;
        const sources = pipelineConfig.rag.sources || ['memory', 'chat', 'telegram'];

        const searchResults = await unifiedSearch(messageText, { topK, sources });
        result.ragContext = searchResults.filter(r => r.score >= minScore);
        const ragTime = Date.now() - ragStart;

        recordStage('search', ragTime); // Optimization #8
        logger.debug(`Found ${result.ragContext.length} RAG results (${searchResults.length} total, ${result.ragContext.length} above threshold)`);
      } catch (err) {
        logger.error(`RAG search failed: ${err.message}`);
        result.ragContext = [];
      }
    }

    // 3. Routing decision
    if (pipelineConfig.routing?.enabled) {
      try {
        const routeStart = Date.now(); // Optimization #8
        // Pass last 2 messages from history for context (sliding window)
        // This helps resolve ambiguous references like "Fix it", "Run that"
        const recentHistory = result.shortTermHistory.slice(-2);
        result.routeDecision = await routeToModel(messageText, recentHistory);
        const routeTime = Date.now() - routeStart;

        recordStage('routing', routeTime); // Optimization #8
        logger.debug(`Route decision: ${result.routeDecision.route} (${result.routeDecision.reason})`);
      } catch (err) {
        logger.error(`Routing failed: ${err.message}`);
        result.routeDecision = {
          route: pipelineConfig.routing.fallback || 'claude_sonnet',
          reason: `Routing error: ${err.message}`,
          priority: 'medium',
        };
      }
    }
  }

  // 3b. Route-aware RAG trimming (Optimization #6)
  // If route-aware sources are enabled, trim RAG results based on route decision.
  // Uses Option B: speculative full search (parallel), then trim post-hoc.
  if (pipelineConfig.features?.routeAwareSources !== false && result.routeDecision) {
    const before = result.ragContext.length;
    result.ragContext = trimRagForRoute(result.ragContext, result.routeDecision);
    if (result.ragContext.length < before) {
      logger.debug(`Route-aware trim: ${before} → ${result.ragContext.length} results for route=${result.routeDecision.route}`);
    }
  }

  // 4. System notes
  if (pipelineConfig.systemNotes?.enabled) {
    const session = getSession(sessionId);
    result.systemNotes = session.systemNotes.map(n => n.note);
  }

  // 5. Assemble final prompt
  const assemblyStart = Date.now(); // Optimization #8
  const assembledMessages = [];

  // Add RAG context as system message if configured
  if (result.ragContext.length > 0 && pipelineConfig.rag?.injectAs === 'system') {
    const ragText = result.ragContext
      .map((r, i) => `[${i + 1}] (${r.source}, score: ${r.score.toFixed(2)})\n${r.text}`)
      .join('\n\n---\n\n');

    assembledMessages.push({
      role: 'system',
      content: `# Retrieved Context\n\n${ragText}`,
    });
  }

  // Add system notes if any
  if (result.systemNotes.length > 0) {
    assembledMessages.push({
      role: 'system',
      content: `# System Notes\n\n${result.systemNotes.join('\n')}`,
    });
  }

  // Add conversation history
  assembledMessages.push(...result.shortTermHistory);

  // Add current user message
  assembledMessages.push(userMessage);

  // Add RAG context inline if configured
  if (result.ragContext.length > 0 && pipelineConfig.rag?.injectAs === 'inline') {
    const ragText = result.ragContext
      .map((r, i) => `[${i + 1}] (${r.source}, score: ${r.score.toFixed(2)})\n${r.text}`)
      .join('\n\n---\n\n');

    assembledMessages.push({
      role: 'system',
      content: `# Retrieved Context for Your Query\n\n${ragText}`,
    });
  }

  result.assembledPrompt = assembledMessages;
  const assemblyTime_stage = Date.now() - assemblyStart;
  recordStage('assembly', assemblyTime_stage); // Optimization #8

  // Persist if enabled
  if (pipelineConfig.persistence?.enabled && pipelineConfig.persistence?.saveTurns) {
    addMessageToSession(sessionId, userMessage);
  }

  // Update stats
  const assemblyTime = Date.now() - startTime;
  stats.avgAssemblyTime = (stats.avgAssemblyTime * (stats.totalCalls - 1) + assemblyTime) / stats.totalCalls;
  result.metadata.assemblyTime = assemblyTime;

  return result;
}

/**
 * Get pipeline statistics
 */
function getStats() {
  // Optimization #8: Calculate stage averages
  const stageAverages = {};
  for (const [name, s] of Object.entries(stats.stages)) {
    stageAverages[name] = s.count > 0 ? Math.round(s.totalMs / s.count) : 0;
  }

  return {
    ...stats,
    activeSessions: sessions.size,
    totalMessages: Array.from(sessions.values()).reduce((sum, s) => sum + s.messages.length, 0),
    stageAverages,  // Optimization #8
    skipRate: stats.totalCalls > 0 ? (stats.skippedCalls / stats.totalCalls) : 0,  // Optimization #5
  };
}

/**
 * Reset statistics
 */
function resetStats() {
  stats.totalCalls = 0;
  stats.skippedCalls = 0;  // Optimization #5
  stats.avgAssemblyTime = 0;
  stats.cacheHits = 0;
  stats.cacheMisses = 0;
  stats.lastReset = new Date().toISOString();

  // Optimization #8: Reset stage stats
  for (const stage of Object.values(stats.stages)) {
    stage.totalMs = 0;
    stage.count = 0;
  }
}

/**
 * Clear a session
 */
function clearSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * List all sessions
 */
function listSessions() {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    messageCount: s.messages.length,
    noteCount: s.systemNotes.length,
    created: s.created,
    lastActive: s.lastActive,
  }));
}

module.exports = {
  assembleContext,
  addMessageToSession,
  getStats,
  resetStats,
  clearSession,
  listSessions,
  addSystemNote,
};
