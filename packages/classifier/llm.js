const { chat } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

const VALID_CATEGORIES = [
  'junk', 'subscriptions', 'bills', 'jobs', 'shopping',
  'travel', 'finance', 'health', 'newsletters',
  'notifications', 'personal', 'legal'
];

async function classifyWithLLM(email, timeout = 5000) {
  try {
    const bodyPreview = email.body
      ? email.body.substring(0, 300)
      : '';

    const prompt = `Classify this email into ONE of these categories: ${VALID_CATEGORIES.join(', ')}.

From: ${email.from}
Subject: ${email.subject}
Body: ${bodyPreview}

Return ONLY the category name, nothing else.`;

    logger.debug('Classifying with LLM:', email.subject);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), timeout);
    });

    const chatPromise = chat(config.models.triage, [
      { role: 'user', content: prompt }
    ]);

    const response = await Promise.race([chatPromise, timeoutPromise]);
    const category = response.message.content.trim().toLowerCase();

    if (!VALID_CATEGORIES.includes(category)) {
      logger.warn(`LLM returned invalid category: ${category}`);
      return { category: 'uncategorized', confidence: 0 };
    }

    return { category, confidence: 0.7 };
  } catch (error) {
    logger.error('LLM classification failed:', error.message);
    return { category: 'uncategorized', confidence: 0 };
  }
}

module.exports = { classifyWithLLM, VALID_CATEGORIES };
