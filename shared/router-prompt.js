'use strict';

/**
 * Builds a system prompt for Qwen to classify user queries
 * into the 5-tier "All-Star" routing architecture.
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
- "claude_opus": Critical execution, security audits, production code review, final implementation of complex systems
- "claude_sonnet": Standard coding tasks, feature implementation, bug fixes, tests, refactoring (default for most coding work ~80%)
- "local_reasoning": Pure logic, math, reasoning puzzles, analytical thinking WITHOUT external tools (DeepSeek R1 local)
- "local_qwen": File search, classification, triage, note lookup, keyword extraction, summarization, data extraction, simple Q&A, simple routing, local-only operations
- "wingman": Autonomous coding tasks requiring file changes across multiple files, long-running work, "dispatch and return later" tasks

Priority:
- "high": Urgent, time-sensitive, production-impacting
- "medium": Normal development work, standard tasks
- "low": Background tasks, nice-to-have, exploratory

Examples:
User: "Review this auth code for security vulnerabilities before deploy"
{"route":"claude_opus","reason":"security audit of production code requires highest accuracy","priority":"high"}

User: "Add a search bar component to the dashboard"
{"route":"claude_sonnet","reason":"standard feature implementation task","priority":"medium"}

User: "Summarize the last 5 git commits"
{"route":"local_qwen","reason":"simple summarization and triage task - use local model","priority":"low"}

User: "Find all files that import the config module"
{"route":"local_qwen","reason":"file search and pattern matching is a local operation","priority":"low"}

User: "Solve this logic puzzle: If A is taller than B, and B is taller than C, who is tallest?"
{"route":"local_reasoning","reason":"pure logic puzzle requiring reasoning but no external tools","priority":"low"}

User: "Refactor the entire authentication module across all files and run tests"
{"route":"wingman","reason":"autonomous multi-file coding task best dispatched to background agent","priority":"medium"}

HISTORY EXAMPLE:
History:
USER: Run the test suite.
ASSISTANT: Tests failed: 3 errors in auth.ts (line 45, 67, 102).
Current: Fix them.
{"route":"claude_sonnet","reason":"'Them' refers to test failures in auth.ts - this is a coding fix task","priority":"high"}

Now classify this query. Return ONLY the JSON object, no other text.
User: "${userQuery.replace(/"/g, '\\"')}"`;
}

module.exports = { buildRouterPrompt };
