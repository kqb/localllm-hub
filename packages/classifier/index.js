const { classify: classifyRules } = require('./rules');
const { classifyWithLLM } = require('./llm');
const logger = require('../../shared/logger');

async function classify(email) {
  const ruleCategory = classifyRules(email);

  if (ruleCategory) {
    logger.debug(`Classified by rule: ${ruleCategory}`);
    return {
      category: ruleCategory,
      confidence: 1.0,
      method: 'rules'
    };
  }

  logger.debug('No rule matched, using LLM fallback');
  const llmResult = await classifyWithLLM(email);

  return {
    category: llmResult.category,
    confidence: llmResult.confidence,
    method: 'llm'
  };
}

module.exports = { classify };
