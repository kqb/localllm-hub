/**
 * Webhook Dispatcher
 *
 * Sends agent events to Clawdbot gateway via the wake command.
 * Uses clawdbot CLI for immediate notification.
 */

const { execFileSync } = require('child_process');

class WebhookDispatcher {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'http://127.0.0.1:18789';
    this.timeout = options.timeout || 5000;
    this.enabled = options.enabled !== false;
  }

  /**
   * Dispatch an event to Clawdbot
   * @param {string} session - Session name
   * @param {string} eventType - Event type (complete, need_input, error, blocked, stuck)
   * @param {string} payload - Event payload/message
   */
  async dispatch(session, eventType, payload) {
    if (!this.enabled) {
      console.log(`[Webhook] DISABLED: ${session} ${eventType}: ${payload}`);
      return;
    }

    const message = this.formatMessage(session, eventType, payload);

    try {
      // Use execFileSync with argument array for security
      // This prevents shell injection even with untrusted payload
      execFileSync(
        'clawdbot',
        ['gateway', 'wake', '--text', message, '--mode', 'now'],
        {
          timeout: this.timeout,
          encoding: 'utf-8',
        }
      );

      console.log(`[Webhook] Sent: ${eventType} for ${session}`);
    } catch (err) {
      // Don't crash if webhook fails - just log
      console.error(`[Webhook] Failed to dispatch ${eventType} for ${session}:`, err.message);
    }
  }

  /**
   * Format event into a user-friendly message
   * @param {string} session - Session name
   * @param {string} type - Event type
   * @param {string} payload - Event payload
   * @returns {string} - Formatted message with emoji
   */
  formatMessage(session, type, payload) {
    const cleanPayload = payload ? `: ${payload}` : '';

    switch (type) {
      case 'complete':
        return `✅ Agent \`${session}\` completed${cleanPayload}`;

      case 'need_input':
        return `❓ Agent \`${session}\` needs input${cleanPayload}`;

      case 'error':
        return `❌ Agent \`${session}\` error${cleanPayload}`;

      case 'blocked':
        return `🚫 Agent \`${session}\` blocked${cleanPayload}`;

      case 'stuck':
        return `⏱️ Agent \`${session}\` appears stuck${cleanPayload}`;

      case 'progress':
        return `📊 Agent \`${session}\` progress: ${payload}%`;

      default:
        return `📡 Agent \`${session}\`: ${type}${cleanPayload}`;
    }
  }

  /**
   * Enable webhook dispatching
   */
  enable() {
    this.enabled = true;
    console.log('[Webhook] Enabled');
  }

  /**
   * Disable webhook dispatching (for testing)
   */
  disable() {
    this.enabled = false;
    console.log('[Webhook] Disabled');
  }
}

module.exports = WebhookDispatcher;
