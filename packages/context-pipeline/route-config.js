"use strict";

const logger = require("../../shared/logger");
const { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");

// Data directory paths
const DATA_DIR = join(__dirname, "../../data");
const ROUTER_FAILURES_PATH = join(DATA_DIR, "router-failures.jsonl");
const ESCALATION_LOG_PATH = join(DATA_DIR, "escalation-log.jsonl");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================================
// ESCALATION SIGNAL DETECTION
// Pattern matching for user messages that should force Opus routing
// ============================================================================

const ESCALATION_SIGNALS = {
  // User referencing past work - indicates need for historical context
  historical: [
    /we (did|built|have|made|created|setup|implemented) (this|that|it) before/i,
    /already (have|setup|built|made|created|established)/i,
    /you should (know|remember|recall)/i,
    /from (our|my) memory/i,
    /existing (setup|system|pipeline|project|implementation)/i,
    /use our/i,
    /we went thr(ough|u) this/i,
    /remember (when|that|the)/i,
    /like (last time|before|we did)/i,
    /as (we|you) (discussed|mentioned|established)/i,
  ],

  // Known project names - auto-escalate when mentioned
  projects: [
    /live-translation-local/i,
    /exocortex/i,
    /relationship-os/i,
    /localllm-hub/i,
    /cascade-multiagent/i,
    /agent-orchestra/i,
    /clawdbot/i,
    /voice memo(s)?/i,
  ],

  // Complex file/system access patterns
  system_access: [
    /Library\/Group Containers/i,
    /\.exocortex/i,
    /ingest/i,
    /diariz(e|ation)/i,
    /whisper/i,
    /transcri(be|ption)/i,
    /pipeline/i,
  ],

  // Trust failure signals - IMMEDIATE Opus, no questions
  trust_failure: [
    /route to opus/i,
    /use opus/i,
    /switch to opus/i,
    /previous model(s)? failed/i,
    /you keep (forgetting|missing|failing)/i,
    /why (can't|couldn't|didn't) you/i,
    /that's not (right|correct|what I asked)/i,
    /try again with opus/i,
    /this needs opus/i,
  ],
};

// Manual routing override patterns
const MANUAL_ROUTING_PATTERNS = [
  /route\s+(to\s+)?(opus|sonnet|haiku)/i,
  /use\s+(opus|sonnet|haiku)/i,
  /switch\s+to\s+(opus|sonnet|haiku)/i,
  /try\s+(with\s+)?(opus|sonnet|haiku)/i,
];

// ============================================================================
// ESCALATION DETECTION FUNCTIONS
// ============================================================================

/**
 * Check if a message contains escalation signals that should force Opus routing.
 * @param {string} message - User message to check
 * @returns {{shouldEscalate: boolean, signals: string[], reason: string}}
 */
function checkEscalationSignals(message) {
  const matched = {
    historical: [],
    projects: [],
    system_access: [],
    trust_failure: [],
  };

  // Check each category
  for (const [category, patterns] of Object.entries(ESCALATION_SIGNALS)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        const match = message.match(pattern);
        matched[category].push(match ? match[0] : pattern.toString());
      }
    }
  }

  // Determine if we should escalate
  // Rule 1: Trust failure signals → IMMEDIATE Opus
  if (matched.trust_failure.length > 0) {
    return {
      shouldEscalate: true,
      signals: matched.trust_failure,
      category: "trust_failure",
      reason: "Trust failure signal detected - immediate escalation",
    };
  }

  // Rule 2: Historical + Projects → Opus
  if (matched.historical.length > 0 && matched.projects.length > 0) {
    return {
      shouldEscalate: true,
      signals: [...matched.historical, ...matched.projects],
      category: "historical_project",
      reason: "User referencing past work on known project",
    };
  }

  // Rule 3: Historical + System access → Opus
  if (matched.historical.length > 0 && matched.system_access.length > 0) {
    return {
      shouldEscalate: true,
      signals: [...matched.historical, ...matched.system_access],
      category: "historical_system",
      reason: "User referencing past work with system access",
    };
  }

  // Rule 4: Projects alone → prefer Opus (configurable minimum)
  if (matched.projects.length > 0) {
    return {
      shouldEscalate: true,
      signals: matched.projects,
      category: "project_reference",
      reason: "Known project referenced - requires context awareness",
    };
  }

  // No escalation needed
  const allMatched = [
    ...matched.historical,
    ...matched.projects,
    ...matched.system_access,
  ];

  return {
    shouldEscalate: false,
    signals: allMatched,
    category: null,
    reason: allMatched.length > 0 ? "Signals detected but below escalation threshold" : "No escalation signals",
  };
}

/**
 * Detect if user is manually requesting a specific model route.
 * @param {string} message - User message
 * @param {string} currentRoute - Current route decision
 * @returns {{isManualOverride: boolean, requestedModel: string|null, pattern: string|null}}
 */
function detectManualRouting(message, currentRoute = null) {
  for (const pattern of MANUAL_ROUTING_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      // Extract model name (opus, sonnet, haiku)
      const modelMatch = message.match(/(opus|sonnet|haiku)/i);
      const requestedModel = modelMatch ? `claude_${modelMatch[1].toLowerCase()}` : null;

      return {
        isManualOverride: true,
        requestedModel,
        pattern: match[0],
        previousRoute: currentRoute,
      };
    }
  }

  return {
    isManualOverride: false,
    requestedModel: null,
    pattern: null,
    previousRoute: currentRoute,
  };
}

/**
 * Log a router failure (user-requested override).
 * @param {object} data - Override data
 */
function logRouterFailure(data) {
  const entry = {
    timestamp: new Date().toISOString(),
    type: "manual_override",
    ...data,
  };

  try {
    appendFileSync(ROUTER_FAILURES_PATH, JSON.stringify(entry) + "\n");
    logger.warn(`Router override logged: ${data.requestedModel} (was: ${data.previousRoute})`);
  } catch (err) {
    logger.error(`Failed to log router failure: ${err.message}`);
  }
}

/**
 * Log an auto-escalation event.
 * @param {object} data - Escalation data
 */
function logEscalation(data) {
  const entry = {
    timestamp: new Date().toISOString(),
    type: "auto_escalation",
    ...data,
  };

  try {
    appendFileSync(ESCALATION_LOG_PATH, JSON.stringify(entry) + "\n");
    logger.info(`Auto-escalation: ${data.reason}`);
  } catch (err) {
    logger.error(`Failed to log escalation: ${err.message}`);
  }
}

/**
 * Apply escalation logic to a route decision.
 * Checks for manual overrides and escalation signals, potentially upgrading the route.
 *
 * @param {string} message - User message
 * @param {object} routeDecision - Original route decision from triage
 * @param {object} options - Additional context (ragScore, confidence, etc.)
 * @returns {object} Updated route decision with escalation info
 */
function applyEscalationLogic(message, routeDecision, options = {}) {
  const { ragScore = 0, confidence = 1.0 } = options;
  let finalRoute = { ...routeDecision };

  // Check 1: Manual override request
  const manualOverride = detectManualRouting(message, routeDecision.route);
  if (manualOverride.isManualOverride && manualOverride.requestedModel) {
    // Log this as a router failure (user lost trust)
    logRouterFailure({
      query: message.substring(0, 200),
      requestedModel: manualOverride.requestedModel,
      previousRoute: routeDecision.route,
      previousReason: routeDecision.reason,
      ragScore,
      confidence,
    });

    return {
      ...finalRoute,
      route: manualOverride.requestedModel,
      reason: `Manual override: user requested ${manualOverride.requestedModel}`,
      priority: "high",
      manualOverride: true,
      originalRoute: routeDecision.route,
    };
  }

  // Check 2: Escalation signals
  const escalation = checkEscalationSignals(message);
  if (escalation.shouldEscalate) {
    const escalatedRoute = "claude_opus";

    // Only log if we're actually changing the route
    if (routeDecision.route !== escalatedRoute) {
      logEscalation({
        query: message.substring(0, 200),
        signals: escalation.signals,
        category: escalation.category,
        originalRoute: routeDecision.route,
        escalatedTo: escalatedRoute,
        reason: escalation.reason,
      });
    }

    return {
      ...finalRoute,
      route: escalatedRoute,
      reason: escalation.reason,
      priority: "high",
      autoEscalated: true,
      escalationSignals: escalation.signals,
      escalationCategory: escalation.category,
      originalRoute: routeDecision.route,
    };
  }

  // Check 3: Low confidence on complex task → auto-escalate
  // complexity >= 7 approximated by: ragScore >= 0.7 (high memory relevance)
  if (ragScore >= 0.7 && confidence < 0.8 && routeDecision.route !== "claude_opus") {
    logEscalation({
      query: message.substring(0, 200),
      category: "low_confidence_complex",
      originalRoute: routeDecision.route,
      escalatedTo: "claude_opus",
      reason: `Low confidence (${confidence.toFixed(2)}) on complex task (RAG score: ${ragScore.toFixed(2)})`,
      ragScore,
      confidence,
    });

    return {
      ...finalRoute,
      route: "claude_opus",
      reason: `Auto-escalated: low confidence (${(confidence * 100).toFixed(0)}%) on complex task`,
      priority: "high",
      autoEscalated: true,
      escalationCategory: "low_confidence_complex",
      originalRoute: routeDecision.route,
    };
  }

  // Check 4: High RAG score + complex query (not already Opus) → escalate
  if (ragScore >= 0.7 && routeDecision.route === "claude_haiku") {
    logEscalation({
      query: message.substring(0, 200),
      category: "high_rag_score",
      originalRoute: routeDecision.route,
      escalatedTo: "claude_sonnet",
      reason: `High RAG score (${ragScore.toFixed(2)}) - upgrading from Haiku to Sonnet`,
      ragScore,
    });

    return {
      ...finalRoute,
      route: "claude_sonnet",
      reason: `Auto-escalated: high context relevance (RAG: ${(ragScore * 100).toFixed(0)}%)`,
      autoEscalated: true,
      escalationCategory: "high_rag_score",
      originalRoute: routeDecision.route,
    };
  }

  // No escalation needed
  return finalRoute;
}

/**
 * Route-aware RAG configuration.
 * Maps route decisions to optimal search parameters.
 *
 * Rationale: A local_qwen file search needs only 3 memory chunks,
 * while a claude_opus architecture review benefits from all 10 across all sources.
 * This reduces injected context tokens by 30-60% for simple routes.
 */
const ROUTE_RAG_CONFIGS = {
  claude_haiku:      { topK: 5,  sources: ["memory", "chat", "telegram"], minScore: 0.3  },
  claude_sonnet:     { topK: 7,  sources: ["memory", "chat", "telegram"], minScore: 0.25 },
  claude_opus:       { topK: 10, sources: ["memory", "chat", "telegram"], minScore: 0.2  },
  // Legacy routes → map to new tiers for backwards compatibility
  local_qwen:       { topK: 5,  sources: ["memory", "chat", "telegram"], minScore: 0.3  },
  local_reasoning:   { topK: 5,  sources: ["memory", "chat", "telegram"], minScore: 0.3  },
  wingman:           { topK: 7,  sources: ["memory", "chat", "telegram"], minScore: 0.25 },
};

const DEFAULT_RAG_CONFIG = { topK: 5, sources: ["memory", "chat", "telegram"], minScore: 0.3 };

/**
 * Get RAG config for a given route decision.
 * @param {object} routeDecision - { route, reason, priority }
 * @param {object} [overrides] - Optional overrides from pipeline config
 * @returns {{ topK: number, sources: string[], minScore: number }}
 */
function getRouteRagConfig(routeDecision, overrides = {}) {
  if (!routeDecision || !routeDecision.route) {
    return { ...DEFAULT_RAG_CONFIG, ...overrides };
  }

  const base = ROUTE_RAG_CONFIGS[routeDecision.route] || DEFAULT_RAG_CONFIG;
  const config = { ...base, ...overrides };

  logger.debug(
    `Route-aware RAG: route=${routeDecision.route} → topK=${config.topK}, sources=[${config.sources}], minScore=${config.minScore}`
  );

  return config;
}

/**
 * Filter and trim RAG results based on route config.
 * Used with Option B (parallel speculative search): run full search,
 * then trim results post-hoc based on route decision.
 *
 * @param {Array} fullResults - Full RAG search results
 * @param {object} routeDecision - Route decision from triage
 * @returns {Array} Filtered and trimmed results
 */
function trimRagForRoute(fullResults, routeDecision) {
  const ragConfig = getRouteRagConfig(routeDecision);

  if (ragConfig.topK === 0) return [];

  return fullResults
    .filter(r => ragConfig.sources.includes(r.source))
    .filter(r => r.score >= ragConfig.minScore)
    .slice(0, ragConfig.topK);
}

module.exports = {
  // RAG config
  getRouteRagConfig,
  trimRagForRoute,
  ROUTE_RAG_CONFIGS,
  DEFAULT_RAG_CONFIG,
  // Escalation detection
  checkEscalationSignals,
  detectManualRouting,
  applyEscalationLogic,
  logRouterFailure,
  logEscalation,
  ESCALATION_SIGNALS,
};
