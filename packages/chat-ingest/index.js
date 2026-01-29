const { readFileSync, statSync } = require('fs');
const { basename } = require('path');
const config = require('../../shared/config');

/**
 * Parse JSONL transcript file and extract user/assistant text messages.
 * Skips thinking blocks, tool calls, system messages.
 * @param {string} jsonlPath - Path to the .jsonl transcript
 * @param {number} [fromOffset=0] - Byte offset to start reading from (for incremental)
 * @returns {{ messages: Array, newOffset: number }}
 */
function parseTranscriptMessages(jsonlPath, fromOffset = 0) {
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
      const cleanText = text.replace(/\[message_id:\s*[^\]]+\]/g, '').trim();
      if (!cleanText) continue;

      messages.push({
        role: msg.role,
        text: cleanText,
        timestamp: parsed.timestamp || new Date(msg.timestamp).toISOString(),
        id: parsed.id,
      });
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

module.exports = { parseTranscriptMessages, chunkMessages };
