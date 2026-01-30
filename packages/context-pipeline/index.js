const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { unifiedSearch } = require('../chat-ingest/unified-search');
const { routeToModel } = require('../triage');

// In-memory session storage with LRU eviction
const sessions = new Map();
const MAX_SESSIONS = 100; // Prevent unbounded growth
const MAX_MESSAGES_PER_SESSION = 1000; // Cap messages per session

// Stats tracking
const stats = {
  totalCalls: 0,
  avgAssemblyTime: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastReset: new Date().toISOString(),
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

  // Deep merge config with options (from shared/config.js pattern)
  function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  const pipelineConfig = deepMerge(config.contextPipeline, options);

  // Normalize message
  const userMessage = typeof message === 'string'
    ? { role: 'user', content: message }
    : message;

  const messageText = typeof userMessage.content === 'string'
    ? userMessage.content
    : JSON.stringify(userMessage.content);

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

    result.shortTermHistory = truncateHistory(
      session.messages,
      maxMessages,
      maxTokens
    );

    logger.debug(`Loaded ${result.shortTermHistory.length} messages from history`);
  }

  // 2. RAG context
  if (pipelineConfig.rag?.enabled) {
    try {
      const topK = pipelineConfig.rag.topK || 5;
      const minScore = pipelineConfig.rag.minScore || 0.3;
      const sources = pipelineConfig.rag.sources || ['memory', 'chat', 'telegram'];

      const searchResults = await unifiedSearch(messageText, { topK, sources });
      result.ragContext = searchResults.filter(r => r.score >= minScore);

      logger.debug(`Found ${result.ragContext.length} RAG results (${searchResults.length} total, ${result.ragContext.length} above threshold)`);
    } catch (err) {
      logger.error(`RAG search failed: ${err.message}`);
      result.ragContext = [];
    }
  }

  // 3. Routing decision
  if (pipelineConfig.routing?.enabled) {
    try {
      // Pass last 2 messages from history for context (sliding window)
      // This helps resolve ambiguous references like "Fix it", "Run that"
      const recentHistory = result.shortTermHistory.slice(-2);
      result.routeDecision = await routeToModel(messageText, recentHistory);
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

  // 4. System notes
  if (pipelineConfig.systemNotes?.enabled) {
    const session = getSession(sessionId);
    result.systemNotes = session.systemNotes.map(n => n.note);
  }

  // 5. Assemble final prompt
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
  return {
    ...stats,
    activeSessions: sessions.size,
    totalMessages: Array.from(sessions.values()).reduce((sum, s) => sum + s.messages.length, 0),
  };
}

/**
 * Reset statistics
 */
function resetStats() {
  stats.totalCalls = 0;
  stats.avgAssemblyTime = 0;
  stats.cacheHits = 0;
  stats.cacheMisses = 0;
  stats.lastReset = new Date().toISOString();
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
