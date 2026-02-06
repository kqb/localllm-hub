/**
 * Signal Parser
 *
 * Parses inline signals from agent terminal output.
 * Signals follow format: :::TYPE:payload:::
 * 
 * IMPORTANT: Only parses signals that appear at the START of a line
 * to avoid false positives from documentation containing signal examples.
 */

// Match signals with [SIGNAL] prefix OR Claude's action prefix (⏺) OR start of line
// Priority: [SIGNAL] prefix is most reliable (from new wingman format)
// Fallback: ⏺ prefix or start-of-line for backwards compatibility
// False positives: "- `:::DONE:::` when..." (embedded in markdown) - filtered by blocklist
const SIGNAL_REGEX = /(?:\[SIGNAL\]|^|⏺)\s*:::(DONE|HELP|ERROR|BLOCKED|PROGRESS):?([^:]*)?:::/gm;

// Known false positive payloads from documentation examples
const FALSE_POSITIVE_PAYLOADS = new Set([
  'summary',
  'question', 
  'reason',
  'message',
  'MVP complete - builds and records',
  'when project setup done',
  'when recording works',
  'when storage works',
  'when done',
  'if stuck on something',
]);

class SignalParser {
  /**
   * Parse text for signal markers
   * @param {string} text - Terminal output text
   * @returns {Array<{type: string, payload: string}>} - Extracted signals
   */
  static parse(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const signals = [];
    let match;

    // Reset regex state
    SIGNAL_REGEX.lastIndex = 0;

    while ((match = SIGNAL_REGEX.exec(text)) !== null) {
      const [, type, payload] = match;
      const cleanPayload = (payload || '').trim();
      
      // Skip known false positive payloads from documentation
      if (FALSE_POSITIVE_PAYLOADS.has(cleanPayload)) {
        continue;
      }
      
      // Skip if payload looks like documentation (contains backticks, "when", etc.)
      if (cleanPayload.includes('`') || cleanPayload.startsWith('when ')) {
        continue;
      }
      
      signals.push({
        type,
        payload: cleanPayload,
      });
    }

    return signals;
  }

  /**
   * Check if text contains any signals
   * @param {string} text - Terminal output text
   * @returns {boolean}
   */
  static hasSignals(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }
    SIGNAL_REGEX.lastIndex = 0;
    return SIGNAL_REGEX.test(text);
  }
}

module.exports = SignalParser;
