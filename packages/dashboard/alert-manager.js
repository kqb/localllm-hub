/**
 * Alert Manager - Prevents notification spam and tracks alert state
 *
 * Supports multiple spam control methods:
 * - None: Immediate alerts (no deduplication)
 * - Batching: Collect alerts for window, dedupe, flush
 * - Rate Limiting: Max 1 per session per N minutes (default)
 * - Exponential Backoff: Progressive delays between alerts
 */

const { existsSync, readFileSync } = require('fs');
const path = require('path');

class AlertManager {
  constructor() {
    // Track which sessions have been alerted
    this.alertedSessions = new Map(); // session -> { alertedAt, event, suppressed, suppressUntil, alertCount }

    // Default settings (overridden by config)
    this.COOLDOWN_MS = 60000; // 1 minute minimum between duplicate alerts
    this.DEFAULT_SUPPRESS_MS = 30 * 60 * 1000; // 30 minutes default suppression

    // Batching state
    this.batchQueue = []; // Array of pending alerts
    this.batchTimer = null;

    // Exponential backoff state
    this.backoffTimers = new Map(); // session -> nextAlertTime

    // Load config
    this.loadConfig();

    console.log('[Alert Manager] Initialized with', this.config.spamControlMethod, 'spam control');
  }

  loadConfig() {
    const configPath = path.join(__dirname, '../../data/alerts-config.json');

    // Default config
    this.config = {
      deliveryMode: 'system',
      spamControlMethod: 'rateLimit',
      batchWindowSeconds: 30,
      rateLimitWindowMinutes: 5,
      exponentialBackoff: {
        enabled: true,
        baseDelayMinutes: 1,
        maxDelayMinutes: 60,
        multiplier: 2,
      },
    };

    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        this.config = { ...this.config, ...config };
      } catch (err) {
        console.warn('[Alert Manager] Error loading config:', err.message);
      }
    }

    // Update cooldown based on rate limit window
    this.COOLDOWN_MS = (this.config.rateLimitWindowMinutes || 5) * 60 * 1000;
  }

  reloadConfig() {
    this.loadConfig();
    console.log('[Alert Manager] Config reloaded:', this.config.spamControlMethod);
  }

  /**
   * Check if we should send an alert for this session/event combo
   * @param {string} session - Session name
   * @param {string} event - Event type (agent_stuck, agent_error, etc.)
   * @returns {boolean} - True if alert should be sent
   */
  shouldAlert(session, event) {
    const now = Date.now();
    const alertState = this.alertedSessions.get(session);

    // Check if suppressed by user (always honored regardless of spam control method)
    if (alertState?.suppressed && now < alertState.suppressUntil) {
      console.log(`[Alert Manager] ${session}: suppressed until ${new Date(alertState.suppressUntil).toLocaleTimeString()}`);
      return false;
    }

    // Apply spam control based on config
    switch (this.config.spamControlMethod) {
      case 'none':
        // No spam control - always alert
        return true;

      case 'batch':
        // Batching - always queue (actual send happens on flush)
        return true;

      case 'rateLimit':
        return this.shouldAlertRateLimit(session, event, now, alertState);

      case 'exponentialBackoff':
        return this.shouldAlertExponentialBackoff(session, event, now, alertState);

      default:
        console.warn('[Alert Manager] Unknown spam control method:', this.config.spamControlMethod);
        return this.shouldAlertRateLimit(session, event, now, alertState);
    }
  }

  shouldAlertRateLimit(session, event, now, alertState) {
    // No prior alert for this session
    if (!alertState) {
      return true;
    }

    // Different event type - allow alert
    if (alertState.event !== event) {
      return true;
    }

    // Same event within cooldown - skip
    const timeSinceLastAlert = now - alertState.alertedAt;
    if (timeSinceLastAlert < this.COOLDOWN_MS) {
      console.log(`[Alert Manager] ${session}: rate limited (${Math.round(timeSinceLastAlert / 1000)}s since last alert)`);
      return false;
    }

    // Cooldown expired, allow re-alert
    return true;
  }

  shouldAlertExponentialBackoff(session, event, now, alertState) {
    // Check if we have a backoff timer for this session
    const nextAlertTime = this.backoffTimers.get(session);
    if (nextAlertTime && now < nextAlertTime) {
      const waitSeconds = Math.round((nextAlertTime - now) / 1000);
      console.log(`[Alert Manager] ${session}: exponential backoff (wait ${waitSeconds}s)`);
      return false;
    }

    // No prior alert or backoff expired
    return true;
  }

  /**
   * Mark session as alerted
   * @param {string} session - Session name
   * @param {string} event - Event type
   */
  markAlerted(session, event) {
    const now = Date.now();
    const alertState = this.alertedSessions.get(session) || { alertCount: 0 };

    // Increment alert count for exponential backoff
    const alertCount = alertState.alertCount + 1;

    this.alertedSessions.set(session, {
      alertedAt: now,
      event,
      suppressed: false,
      suppressUntil: null,
      alertCount,
    });

    // Set exponential backoff timer if enabled
    if (this.config.spamControlMethod === 'exponentialBackoff') {
      const backoffConfig = this.config.exponentialBackoff;
      const delayMinutes = Math.min(
        backoffConfig.baseDelayMinutes * Math.pow(backoffConfig.multiplier, alertCount - 1),
        backoffConfig.maxDelayMinutes
      );
      const nextAlertTime = now + delayMinutes * 60 * 1000;
      this.backoffTimers.set(session, nextAlertTime);
      console.log(`[Alert Manager] ${session}: marked as alerted for ${event} (next in ${delayMinutes}m, count: ${alertCount})`);
    } else {
      console.log(`[Alert Manager] ${session}: marked as alerted for ${event}`);
    }
  }

  /**
   * Reset alert state when agent resumes activity
   * @param {string} session - Session name
   */
  resetCooldown(session) {
    if (this.alertedSessions.has(session)) {
      this.alertedSessions.delete(session);
      this.backoffTimers.delete(session);
      console.log(`[Alert Manager] ${session}: cooldown reset (activity resumed)`);
    }
  }

  /**
   * Suppress alerts for a session for a specified duration
   * @param {string} session - Session name
   * @param {number} durationMs - Suppression duration in milliseconds (default: 30 min)
   */
  suppressAlerts(session, durationMs = this.DEFAULT_SUPPRESS_MS) {
    const now = Date.now();
    const suppressUntil = now + durationMs;

    const alertState = this.alertedSessions.get(session) || {
      alertedAt: now,
      event: 'suppressed',
    };

    alertState.suppressed = true;
    alertState.suppressUntil = suppressUntil;

    this.alertedSessions.set(session, alertState);

    console.log(`[Alert Manager] ${session}: alerts suppressed for ${Math.round(durationMs / 60000)} minutes`);
  }

  /**
   * Clear suppression for a session
   * @param {string} session - Session name
   */
  unsuppressAlerts(session) {
    const alertState = this.alertedSessions.get(session);
    if (alertState) {
      alertState.suppressed = false;
      alertState.suppressUntil = null;
      this.alertedSessions.set(session, alertState);
      console.log(`[Alert Manager] ${session}: suppression cleared`);
    }
  }

  /**
   * Get alert state for debugging
   * @returns {Array} - Array of alert states
   */
  getAlertStates() {
    const states = [];
    for (const [session, state] of this.alertedSessions.entries()) {
      states.push({
        session,
        ...state,
        suppressedTimeRemaining: state.suppressed ? Math.max(0, state.suppressUntil - Date.now()) : 0,
      });
    }
    return states;
  }

  /**
   * Queue an alert for batching
   * @param {string} session - Session name
   * @param {string} event - Event type
   * @param {Object} data - Alert data
   */
  queueAlert(session, event, data) {
    // Dedupe: remove existing alerts for same session+event
    this.batchQueue = this.batchQueue.filter(
      alert => !(alert.session === session && alert.event === event)
    );

    // Add to queue
    this.batchQueue.push({ session, event, data, timestamp: Date.now() });

    // Start batch timer if not already running
    if (!this.batchTimer) {
      const windowMs = (this.config.batchWindowSeconds || 30) * 1000;
      this.batchTimer = setTimeout(() => {
        this.flushBatch();
      }, windowMs);
      console.log(`[Alert Manager] Batch timer started (${this.config.batchWindowSeconds}s window)`);
    }
  }

  /**
   * Flush all queued alerts
   * @returns {Array} - Array of alerts to send
   */
  flushBatch() {
    if (this.batchQueue.length === 0) {
      return [];
    }

    const alerts = [...this.batchQueue];
    this.batchQueue = [];
    this.batchTimer = null;

    console.log(`[Alert Manager] Flushed ${alerts.length} batched alert(s)`);
    return alerts;
  }

  /**
   * Get current config
   * @returns {Object} - Current config
   */
  getConfig() {
    return { ...this.config };
  }
}

module.exports = AlertManager;
