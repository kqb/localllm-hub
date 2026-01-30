"use strict";

const logger = require("../../shared/logger");

/**
 * Estimate token count for text. Rough heuristic: ~4 chars per token.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Compress conversation history by summarizing older messages.
 * Keeps the most recent messages verbatim and summarizes the rest
 * using a local model (cheap and fast).
 *
 * Falls back to hard truncation if summarization fails.
 *
 * @param {Array} messages - Full message history
 * @param {number} maxMessages - Max messages to keep
 * @param {number} maxTokens - Token budget
 * @param {object} [options]
 * @param {number} [options.keepVerbatim=5] - Messages to keep verbatim at the end
 * @param {number} [options.summaryMaxTokens=150] - Max tokens for summary output
 * @returns {Promise<Array>} Compressed message history
 */
async function compressHistory(messages, maxMessages, maxTokens, options = {}) {
  const keepVerbatim = options.keepVerbatim || 5;
  const summaryMaxTokens = options.summaryMaxTokens || 150;

  const recent = messages.slice(-maxMessages);
  const recentTokens = recent.reduce((sum, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(text);
  }, 0);

  // Under budget — return as-is
  if (recentTokens <= maxTokens) return recent;

  // Split into summarizable and verbatim parts
  const toSummarize = recent.slice(0, -keepVerbatim);
  const verbatim = recent.slice(-keepVerbatim);

  if (toSummarize.length === 0) {
    // Even last N messages exceed budget — hard truncate
    return hardTruncate(messages, maxMessages, maxTokens);
  }

  // Build summary using local model (cheap, fast)
  try {
    const { generate } = require("../../shared/ollama");
    const config = require("../../shared/config");

    const summaryText = toSummarize
      .map(m => {
        const content = typeof m.content === "string" ? m.content : "[complex content]";
        return `${m.role}: ${content}`;
      })
      .join("\n")
      .slice(0, 2000); // Cap input to avoid overloading local model

    const resp = await generate(
      config.models.triage,
      `Summarize this conversation in 2-3 sentences, preserving key decisions and topics:\n\n${summaryText}`,
      { options: { num_predict: summaryMaxTokens } }
    );

    logger.debug(
      `History compression: summarized ${toSummarize.length} messages, keeping ${verbatim.length} verbatim`
    );

    return [
      {
        role: "system",
        content: `[Earlier conversation summary: ${resp.response.trim()}]`,
      },
      ...verbatim,
    ];
  } catch (err) {
    logger.error(`History compression failed, falling back to truncation: ${err.message}`);
    return hardTruncate(messages, maxMessages, maxTokens);
  }
}

/**
 * Hard truncation: drop oldest messages until under token budget.
 * @param {Array} messages
 * @param {number} maxMessages
 * @param {number} maxTokens
 * @returns {Array}
 */
function hardTruncate(messages, maxMessages, maxTokens) {
  let result = messages.slice(-maxMessages);
  let totalTokens = result.reduce((sum, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(text);
  }, 0);

  while (totalTokens > maxTokens && result.length > 1) {
    const removed = result.shift();
    const text = typeof removed.content === "string" ? removed.content : JSON.stringify(removed.content);
    totalTokens -= estimateTokens(text);
  }

  return result;
}

/**
 * Deduplicate consecutive identical messages (e.g., from retry logic).
 * Keeps the first occurrence, drops subsequent duplicates.
 *
 * @param {Array} messages
 * @returns {Array} Deduplicated messages
 */
function deduplicateMessages(messages) {
  if (messages.length <= 1) return messages;

  const result = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    const prevText = typeof prev.content === "string" ? prev.content : JSON.stringify(prev.content);
    const currText = typeof curr.content === "string" ? curr.content : JSON.stringify(curr.content);

    if (prev.role !== curr.role || prevText !== currText) {
      result.push(curr);
    }
  }

  if (result.length < messages.length) {
    logger.debug(`Deduplicated ${messages.length - result.length} duplicate messages`);
  }

  return result;
}

module.exports = {
  compressHistory,
  hardTruncate,
  deduplicateMessages,
  estimateTokens,
};
