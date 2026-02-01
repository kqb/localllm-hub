'use strict';

/**
 * Builds a system prompt for Qwen to classify user queries
 * into the 3-tier Anthropic routing architecture.
 * 
 * Tiers: haiku (fast/cheap) → sonnet (standard) → opus (complex)
 * Haiku and Sonnet can auto-escalate if task is too complex.
 * 
 * @param {string} userQuery - The current user message to classify
 * @param {Array} recentHistory - Last 2-3 messages for context (optional)
 * @returns {string} System prompt for the router
 */
function buildRouterPrompt(userQuery, recentHistory = []) {
  // Format history block (if provided)
  const historyBlock = recentHistory.length > 0
    ? `\n\nCONVERSATION HISTORY (for context only):\n${recentHistory.map(msg => {
        const content = msg.content.substring(0, 200); // Truncate to 200 chars
        return `${msg.role.toUpperCase()}: ${content}${msg.content.length > 200 ? '...' : ''}`;
      }).join('\n')}\n`
    : '';

  return `You are a task router. Classify the CURRENT REQUEST into exactly one route and return ONLY valid JSON.

IMPORTANT: Use HISTORY only to resolve ambiguous references (e.g., "it", "that file", "the error"). Always classify the CURRENT REQUEST, not historical messages.${historyBlock}

Routes (pick one):
- "claude_haiku": Simple Q&A, status checks, greetings, acknowledgments, quick lookups, file search, classification, keyword extraction, simple routing
- "claude_sonnet": Standard coding tasks, feature implementation, bug fixes, tests, refactoring, moderate analysis, general tasks (default for most work ~70%)
- "claude_opus": Complex architecture, hard debugging, security audits, multi-file refactors, deep analysis, production-critical decisions

Priority:
- "high": Urgent, time-sensitive, production-impacting
- "medium": Normal development work, standard tasks
- "low": Background tasks, nice-to-have, exploratory

Examples:
User: "What time is it?"
{"route":"claude_haiku","reason":"simple question, no analysis needed","priority":"low"}

User: "Check my calendar for today"
{"route":"claude_haiku","reason":"simple lookup task","priority":"low"}

User: "Hi"
{"route":"claude_haiku","reason":"greeting","priority":"low"}

User: "Summarize the last 5 git commits"
{"route":"claude_haiku","reason":"simple summarization task","priority":"low"}

User: "Add a search bar component to the dashboard"
{"route":"claude_sonnet","reason":"standard feature implementation task","priority":"medium"}

User: "Fix the failing tests in auth.ts"
{"route":"claude_sonnet","reason":"standard bug fix task","priority":"medium"}

User: "Refactor the entire authentication module across all files"
{"route":"claude_sonnet","reason":"multi-file refactor but standard complexity","priority":"medium"}

User: "Review this auth code for security vulnerabilities before deploy"
{"route":"claude_opus","reason":"security audit requires highest accuracy","priority":"high"}

User: "Design the architecture for a new microservice system"
{"route":"claude_opus","reason":"complex architecture design requiring deep analysis","priority":"medium"}

User: "Debug this race condition in the distributed queue"
{"route":"claude_opus","reason":"hard debugging of concurrency issue","priority":"high"}

HISTORY EXAMPLE:
History:
USER: Run the test suite.
ASSISTANT: Tests failed: 3 errors in auth.ts (line 45, 67, 102).
Current: Fix them.
{"route":"claude_sonnet","reason":"'Them' refers to test failures in auth.ts - standard fix task","priority":"high"}

Now classify this query. Return ONLY the JSON object, no other text.
User: "${userQuery.replace(/"/g, '\\"')}"`;
}

module.exports = { buildRouterPrompt };
