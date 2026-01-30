const { classify } = require('@localllm/classifier');
const { rateUrgency, routeTask } = require('@localllm/triage');
const logger = require('../../shared/logger');
const { recordPipelineRun } = require('./history');

/**
 * Email Triage Pipeline
 * classify → urgency → route → notify
 *
 * @param {Object} email - Email object {from, subject, body, labels}
 * @param {Object} options - Pipeline options
 * @param {Function} options.onNotify - Callback for high-urgency notifications
 * @param {number} options.notifyThreshold - Urgency threshold for notifications (default: 4)
 * @returns {Promise<Object>} Pipeline result
 */
async function emailTriagePipeline(email, options = {}) {
  const startTime = Date.now();
  const { onNotify, notifyThreshold = 4 } = options;

  const result = {
    email: {
      from: email.from,
      subject: email.subject,
      bodyPreview: email.body?.slice(0, 100) || '',
    },
    steps: {},
    timestamp: new Date().toISOString(),
    duration: 0,
  };

  try {
    // Step 1: Classify
    logger.debug('[Pipeline] Email triage: classifying...');
    const classifyStart = Date.now();
    const classification = await classify(email);
    result.steps.classify = {
      category: classification.category,
      confidence: classification.confidence,
      method: classification.method,
      duration: Date.now() - classifyStart,
    };

    // Step 2: Rate urgency
    logger.debug('[Pipeline] Email triage: rating urgency...');
    const urgencyStart = Date.now();
    const urgencyResult = await rateUrgency(`${email.subject}\n${email.body}`);
    result.steps.urgency = {
      urgency: urgencyResult.urgency,
      reasoning: urgencyResult.reasoning,
      duration: Date.now() - urgencyStart,
    };

    // Step 3: Route decision
    logger.debug('[Pipeline] Email triage: routing...');
    const routeStart = Date.now();
    const routeResult = await routeTask(`Category: ${classification.category}, Urgency: ${urgencyResult.urgency}`);
    result.steps.route = {
      route: routeResult.route,
      confidence: routeResult.confidence,
      duration: Date.now() - routeStart,
    };

    // Step 4: Notify if high urgency
    if (urgencyResult.urgency >= notifyThreshold) {
      logger.info(`[Pipeline] High urgency email (${urgencyResult.urgency}): ${email.subject}`);
      result.steps.notify = {
        triggered: true,
        reason: `Urgency ${urgencyResult.urgency} >= threshold ${notifyThreshold}`,
      };
      if (onNotify) {
        await onNotify({
          email,
          classification,
          urgency: urgencyResult,
          route: routeResult,
        });
      }
    } else {
      result.steps.notify = {
        triggered: false,
        reason: `Urgency ${urgencyResult.urgency} < threshold ${notifyThreshold}`,
      };
    }

    result.duration = Date.now() - startTime;
    result.success = true;

    // Record to history
    await recordPipelineRun('email-triage', result);

    logger.info(`[Pipeline] Email triage completed in ${result.duration}ms`);
    return result;

  } catch (error) {
    result.duration = Date.now() - startTime;
    result.success = false;
    result.error = error.message;

    await recordPipelineRun('email-triage', result);

    logger.error('[Pipeline] Email triage failed:', error);
    throw error;
  }
}

module.exports = { emailTriagePipeline };
