const { readFileSync, statSync } = require('fs');
const { basename } = require('path');
const config = require('../../shared/config');

/**
 * Strip ANSI escape codes and excessive markdown formatting
 */
function stripArtifacts(text) {
  return text
    // ANSI escape codes
    .replace(/\x1b\[[0-9;]*m/g, '')
    // Excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Determine if a message should be indexed (Tier 2 content filtering).
 *
 * Only index assistant messages that contain substantive content:
 * - Role must be 'assistant' (my decisions/explanations, not user questions)
 * - Length must be > 100 chars (skip short acks like "ok", "done")
 * - No tool calls or tool results (already filtered by parseTranscriptMessages)
 *
 * @param {object} msg - Parsed message with { role, text, timestamp, id }
 * @returns {boolean}
 */
function shouldIndexMessage(msg) {
  // Filter 1: Only assistant messages (my knowledge, not user questions)
  if (msg.role !== 'assistant') {
    return false;
  }

  // Filter 2: Length threshold - skip short acknowledgments
  if (msg.text.length <= 100) {
    return false;
  }

  // Filter 3: Tool calls/results are already excluded by parseTranscriptMessages
  // (only 'text' parts are extracted, not 'tool_call' or 'tool_result' types)

  return true;
}

/**
 * Parse JSONL transcript file and extract user/assistant text messages.
 * Skips thinking blocks, tool calls, system messages.
 * @param {string} jsonlPath - Path to the .jsonl transcript
 * @param {number} [fromOffset=0] - Byte offset to start reading from (for incremental)
 * @param {boolean} [filterForIndexing=false] - Apply Tier 2 content filters (assistant-only, length>100)
 * @returns {{ messages: Array, newOffset: number }}
 */
function parseTranscriptMessages(jsonlPath, fromOffset = 0, filterForIndexing = false) {
  const stat = statSync(jsonlPath);
  const content = readFileSync(jsonlPath, 'utf-8');

  // If reading incrementally, slice from offset
  const data = fromOffset > 0 ? content.slice(fromOffset) : content;
  const lines = data.split(/\r?\n/);

  const messages = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type !== 'message') continue;

      const msg = parsed.message;
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;

      // Extract text content, skip thinking blocks and tool stuff
      const textParts = [];
      if (typeof msg.content === 'string') {
        textParts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && typeof part.text === 'string') {
            textParts.push(part.text);
          }
          // Skip: thinking, tool_call, tool_result, image, etc.
        }
      }

      const text = textParts.join('\n').trim();
      if (!text) continue;

      // Strip envelope metadata like [message_id: ...] from user messages
      let cleanText = text.replace(/\[message_id:\s*[^\]]+\]/g, '').trim();
      if (!cleanText) continue;

      // Strip ANSI codes and formatting artifacts
      cleanText = stripArtifacts(cleanText);
      if (!cleanText) continue;

      const message = {
        role: msg.role,
        text: cleanText,
        timestamp: parsed.timestamp || new Date(msg.timestamp).toISOString(),
        id: parsed.id,
      };

      // Apply Tier 2 content filtering if requested (for indexing)
      if (filterForIndexing) {
        if (!shouldIndexMessage(message)) {
          continue;
        }
      }

      messages.push(message);
    } catch {
      // skip malformed lines
    }
  }

  return { messages, newOffset: stat.size };
}

/**
 * Group messages into conversational chunks with role prefixes.
 * @param {Array} messages - Parsed messages from parseTranscriptMessages
 * @param {string} sessionId - Session identifier
 * @param {string} filePath - Source file path
 * @returns {Array} chunks with text, metadata
 */
function chunkMessages(messages, sessionId, filePath) {
  const maxChunkSize = config.embedding.chunkSize;
  const chunks = [];
  let currentText = '';
  let startTs = null;
  let endTs = null;

  function flushChunk() {
    if (currentText.trim()) {
      chunks.push({
        text: currentText.trim(),
        sessionId,
        file: filePath,
        startTs,
        endTs,
      });
    }
    currentText = '';
    startTs = null;
    endTs = null;
  }

  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : 'Assistant';
    const line = `${prefix}: ${msg.text}`;

    if ((currentText + '\n' + line).length > maxChunkSize && currentText) {
      flushChunk();
    }

    if (!startTs) startTs = msg.timestamp;
    endTs = msg.timestamp;
    currentText += (currentText ? '\n' : '') + line;
  }

  flushChunk();
  return chunks;
}

module.exports = { parseTranscriptMessages, chunkMessages, shouldIndexMessage, stripArtifacts };
