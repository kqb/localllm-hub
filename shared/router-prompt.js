'use strict';

/**
 * Builds a system prompt for Qwen to classify user queries
 * into the 5-tier "All-Star" routing architecture.
 */
function buildRouterPrompt(userQuery) {
  return `You are a task router. Classify the user query into exactly one route and return ONLY valid JSON.

Routes (pick one):
- "gemini_3_pro": Deep reasoning, strategic planning, architecture design, exploring multiple approaches, research, 1M+ context tasks
- "claude_opus": Critical execution, security audits, production code review, final implementation of complex systems
- "claude_sonnet": Standard coding tasks, feature implementation, bug fixes, tests, refactoring (default for most coding work ~80%)
- "claude_haiku": Quick triage, summarization, data extraction, simple Q&A, formatting, fast lookups
- "local_qwen": File search, classification, note lookup, keyword extraction, simple routing, local-only operations

Priority:
- "high": Urgent, time-sensitive, production-impacting
- "medium": Normal development work, standard tasks
- "low": Background tasks, nice-to-have, exploratory

Examples:
User: "Plan the architecture for a new microservice system"
{"route":"gemini_3_pro","reason":"strategic architecture planning requires deep multi-angle reasoning","priority":"medium"}

User: "Review this auth code for security vulnerabilities before deploy"
{"route":"claude_opus","reason":"security audit of production code requires highest accuracy","priority":"high"}

User: "Add a search bar component to the dashboard"
{"route":"claude_sonnet","reason":"standard feature implementation task","priority":"medium"}

User: "Summarize the last 5 git commits"
{"route":"claude_haiku","reason":"simple summarization task","priority":"low"}

User: "Find all files that import the config module"
{"route":"local_qwen","reason":"file search and pattern matching is a local operation","priority":"low"}

Now classify this query. Return ONLY the JSON object, no other text.
User: "${userQuery.replace(/"/g, '\\"')}"`;
}

module.exports = { buildRouterPrompt };
