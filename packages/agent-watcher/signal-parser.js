/**
 * Signal Parser
 *
 * Parses inline signals from agent terminal output.
 * Signals follow format: :::TYPE:payload:::
 */

const SIGNAL_REGEX = /:::(DONE|HELP|ERROR|BLOCKED|PROGRESS):?([^:]*)?:::/g;

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
      signals.push({
        type,
        payload: payload || '',
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
