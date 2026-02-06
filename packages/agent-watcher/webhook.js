/**
 * Webhook Dispatcher
 *
 * Sends agent events to Clawdbot gateway via the wake command.
 * Supports batching to reduce notification spam.
 */

const { execFileSync } = require('child_process');

class WebhookDispatcher {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'http://127.0.0.1:18789';
    this.timeout = options.timeout || 5000;
    this.enabled = options.enabled !== false;
    
    // Batching configuration
    this.batchIntervalMs = options.batchIntervalMs || 10000; // 10 seconds
    this.batchEnabled = options.batchEnabled !== false;
    
    // Pending events per session: session -> [{type, payload, ts}]
    this.pendingEvents = new Map();
    
    // Start batch flush timer
    if (this.batchEnabled) {
      this._batchTimer = setInterval(() => this._flushBatches(), this.batchIntervalMs);
    }
  }

  /**
   * Dispatch an event to Clawdbot (queued for batching)
   * @param {string} session - Session name
   * @param {string} eventType - Event type (complete, need_input, error, blocked, stuck)
   * @param {string} payload - Event payload/message
   */
  async dispatch(session, eventType, payload) {
    if (!this.enabled) {
      console.log(`[Webhook] DISABLED: ${session} ${eventType}: ${payload}`);
      return;
    }

    // High-priority events bypass batching
    const highPriority = ['complete', 'error', 'need_input', 'blocked', 'stuck'];
    
    if (!this.batchEnabled || highPriority.includes(eventType)) {
      // Send immediately
      this._sendNow(session, eventType, payload);
      return;
    }

    // Queue for batching (progress events)
    if (!this.pendingEvents.has(session)) {
      this.pendingEvents.set(session, []);
    }
    
    this.pendingEvents.get(session).push({
      type: eventType,
      payload,
      ts: Date.now(),
    });
  }

  /**
   * Send event immediately
   * @private
   */
  _sendNow(session, eventType, payload) {
    const message = this.formatMessage(session, eventType, payload);

    try {
      execFileSync(
        'clawdbot',
        ['system', 'event', '--text', message, '--mode', 'now'],
        {
          timeout: this.timeout,
          encoding: 'utf-8',
          env: { ...process.env, FORCE_COLOR: '0' },
        }
      );

      console.log(`[Webhook] Sent: ${eventType} for ${session}`);
    } catch (err) {
      console.error(`[Webhook] Failed to dispatch ${eventType} for ${session}:`, err.message);
    }
  }

  /**
   * Flush all pending batches
   * @private
   */
  _flushBatches() {
    for (const [session, events] of this.pendingEvents) {
      if (events.length === 0) continue;

      // Summarize progress events
      const progressEvents = events.filter(e => e.type === 'progress');
      const otherEvents = events.filter(e => e.type !== 'progress');

      // Build batch message
      let message = `[BATCH] Agent ${session}:`;
      
      if (progressEvents.length > 0) {
        const latestProgress = progressEvents[progressEvents.length - 1];
        message += ` progress ${latestProgress.payload}%`;
        if (progressEvents.length > 1) {
          message += ` (${progressEvents.length} updates)`;
        }
      }

      for (const event of otherEvents) {
        message += `\n  - ${event.type.toUpperCase()}${event.payload ? ': ' + event.payload : ''}`;
      }

      // Send batch
      try {
        execFileSync(
          'clawdbot',
          ['system', 'event', '--text', message, '--mode', 'now'],
          {
            timeout: this.timeout,
            encoding: 'utf-8',
            env: { ...process.env, FORCE_COLOR: '0' },
          }
        );
        console.log(`[Webhook] Sent batch for ${session}: ${events.length} events`);
      } catch (err) {
        console.error(`[Webhook] Failed to dispatch batch for ${session}:`, err.message);
      }

      // Clear pending events
      this.pendingEvents.set(session, []);
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
        return `[DONE] Agent ${session} completed${cleanPayload}`;

      case 'need_input':
        return `[HELP] Agent ${session} needs input${cleanPayload}`;

      case 'error':
        return `[ERROR] Agent ${session} error${cleanPayload}`;

      case 'blocked':
        return `[BLOCKED] Agent ${session} blocked${cleanPayload}`;

      case 'stuck':
        return `[STUCK] Agent ${session} appears stuck${cleanPayload}`;

      case 'progress':
        return `[PROGRESS] Agent ${session}: ${payload}%`;

      default:
        return `[AGENT] ${session}: ${type}${cleanPayload}`;
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

  /**
   * Stop the batch timer (for clean shutdown)
   */
  stop() {
    if (this._batchTimer) {
      clearInterval(this._batchTimer);
      this._batchTimer = null;
    }
    // Flush any remaining events
    this._flushBatches();
  }
}

module.exports = WebhookDispatcher;
