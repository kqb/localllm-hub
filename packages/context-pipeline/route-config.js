"use strict";

const logger = require("../../shared/logger");

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
  getRouteRagConfig,
  trimRagForRoute,
  ROUTE_RAG_CONFIGS,
  DEFAULT_RAG_CONFIG,
};
