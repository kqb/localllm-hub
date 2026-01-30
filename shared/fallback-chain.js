'use strict';

/**
 * Cross-provider fallback chains for 5-tier routing.
 * When a route is unavailable, resolve to next best alternative.
 */

const FALLBACK_CHAINS = {
  claude_haiku: ['claude_sonnet'],
  claude_sonnet: ['gemini_3_pro'],
  claude_opus: ['gemini_3_pro'],
  gemini_3_pro: ['claude_opus'],
  local_qwen: ['claude_haiku'],
};

/**
 * Get ordered fallback list for a route.
 * @param {string} route - Primary route name
 * @returns {string[]} - Ordered fallback routes
 */
function getFallback(route) {
  return FALLBACK_CHAINS[route] || [];
}

/**
 * Resolve route with fallback chain. Walks the chain until finding
 * an available provider or exhausting all options.
 * @param {string} route - Primary route name
 * @param {string[]} availableProviders - List of currently available provider routes
 * @returns {string|null} - Resolved route or null if none available
 */
function resolveRoute(route, availableProviders) {
  if (availableProviders.includes(route)) {
    return route;
  }

  const fallbacks = getFallback(route);
  for (const fallback of fallbacks) {
    if (availableProviders.includes(fallback)) {
      return fallback;
    }
  }

  // No fallback found
  return null;
}

module.exports = { getFallback, resolveRoute };
