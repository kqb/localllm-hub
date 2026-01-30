const { chat, generate } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { buildRouterPrompt } = require('../../shared/router-prompt');

async function rateUrgency(text) {
  const prompt = `Rate the urgency of this message on a scale of 1-5:
1 = Not urgent, can wait days
2 = Low urgency, can wait 24 hours
3 = Medium urgency, should handle today
4 = High urgency, handle within hours
5 = Critical urgency, immediate action required

Message: ${text}

Return a JSON object with "urgency" (1-5) and "reasoning" (brief explanation).`;

  try {
    const response = await chat(config.models.triage, [
      { role: 'user', content: prompt }
    ]);

    const content = response.message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        urgency: Math.min(5, Math.max(1, result.urgency || 3)),
        reasoning: result.reasoning || 'No reasoning provided'
      };
    }

    const numberMatch = content.match(/\b([1-5])\b/);
    const urgency = numberMatch ? parseInt(numberMatch[1]) : 3;

    return { urgency, reasoning: content };
  } catch (error) {
    logger.error('Urgency rating failed:', error.message);
    return { urgency: 3, reasoning: 'Error during classification' };
  }
}

async function routeTask(text) {
  const prompt = `Determine if this task should be handled locally (fast, simple) or escalated to API (complex, requires research):

Task: ${text}

Return JSON with:
- "route": "local" or "api"
- "confidence": 0.0-1.0
- "reasoning": brief explanation

Local tasks: simple queries, straightforward operations, quick lookups
API tasks: complex analysis, research required, multi-step reasoning`;

  try {
    const response = await chat(config.models.triage, [
      { role: 'user', content: prompt }
    ]);

    const content = response.message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        route: result.route === 'api' ? 'api' : 'local',
        confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
        reasoning: result.reasoning || 'No reasoning provided'
      };
    }

    return { route: 'local', confidence: 0.5, reasoning: content };
  } catch (error) {
    logger.error('Task routing failed:', error.message);
    return { route: 'local', confidence: 0.5, reasoning: 'Error during routing' };
  }
}

const VALID_ROUTES = ['gemini_3_pro', 'claude_opus', 'claude_sonnet', 'claude_haiku', 'local_qwen'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];

async function routeToModel(prompt) {
  const systemPrompt = buildRouterPrompt(prompt);

  try {
    const response = await generate(config.models.triage, systemPrompt, {
      format: 'json',
    });

    const content = response.response.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        route: VALID_ROUTES.includes(result.route) ? result.route : 'claude_sonnet',
        reason: result.reason || 'No reason provided',
        priority: VALID_PRIORITIES.includes(result.priority) ? result.priority : 'medium',
      };
    }

    return { route: 'claude_sonnet', reason: 'Failed to parse router output', priority: 'medium' };
  } catch (error) {
    logger.error('Model routing failed:', error.message);
    return { route: 'claude_sonnet', reason: 'Error during routing', priority: 'medium' };
  }
}

module.exports = { rateUrgency, routeTask, routeToModel };
