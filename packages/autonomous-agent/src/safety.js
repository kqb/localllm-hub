import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

/**
 * Safety controls for autonomous agent
 * - Rate limiting
 * - Circuit breakers
 * - Cost tracking
 * - Resource monitoring
 */

class SafetyController {
  constructor() {
    this.state = {
      api_calls_today: 0,
      actions_today: 0,
      alerts_this_hour: 0,
      cost_today: 0,
      consecutive_failures: 0,
      circuit_breaker_open: false,
      last_reset: Date.now(),
      last_hour_reset: Date.now()
    };

    this.limits = config.safety;
    this.actionLimits = config.action.rate_limits;
  }

  /**
   * Check if we're in quiet hours (user sleeping)
   */
  isQuietHours() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMin] = this.limits.quiet_hours.start.split(':').map(Number);
    const [endHour, endMin] = this.limits.quiet_hours.end.split(':').map(Number);
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 23:00 - 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }

    return currentTime >= startTime && currentTime < endTime;
  }

  /**
   * Reset daily counters at midnight
   */
  _checkDailyReset() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    if (now - this.state.last_reset > dayMs) {
      this.state.api_calls_today = 0;
      this.state.actions_today = 0;
      this.state.cost_today = 0;
      this.state.last_reset = now;
    }
  }

  /**
   * Reset hourly counters
   */
  _checkHourlyReset() {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    if (now - this.state.last_hour_reset > hourMs) {
      this.state.alerts_this_hour = 0;
      this.state.last_hour_reset = now;
    }
  }

  /**
   * Check if an API call is allowed
   */
  canMakeApiCall(tier = 1) {
    this._checkDailyReset();

    if (this.state.circuit_breaker_open) {
      return { allowed: false, reason: 'Circuit breaker open' };
    }

    if (this.state.api_calls_today >= this.actionLimits.api_calls_per_day) {
      return { allowed: false, reason: 'Daily API call limit reached' };
    }

    // Estimate cost based on tier
    const costEstimate = tier === 1 ? 0 : tier === 2 ? 0.01 : 1;
    if (this.state.cost_today + costEstimate > this.limits.max_cost_per_day) {
      return { allowed: false, reason: 'Daily cost limit reached' };
    }

    return { allowed: true };
  }

  /**
   * Record an API call
   */
  recordApiCall(tier = 1, actualCost = null) {
    this.state.api_calls_today++;

    const cost = actualCost ?? (tier === 1 ? 0 : tier === 2 ? 0.01 : 1);
    this.state.cost_today += cost;

    return {
      calls_remaining: this.actionLimits.api_calls_per_day - this.state.api_calls_today,
      cost_remaining: this.limits.max_cost_per_day - this.state.cost_today
    };
  }

  /**
   * Check if an action is allowed
   */
  canTakeAction(actionType) {
    this._checkDailyReset();

    if (this.state.circuit_breaker_open) {
      return { allowed: false, reason: 'Circuit breaker open' };
    }

    if (this.state.actions_today >= this.actionLimits.actions_per_day) {
      return { allowed: false, reason: 'Daily action limit reached' };
    }

    if (actionType === 'alert') {
      this._checkHourlyReset();
      if (this.state.alerts_this_hour >= this.actionLimits.alerts_per_hour) {
        return { allowed: false, reason: 'Hourly alert limit reached' };
      }
    }

    if (this.isQuietHours() && actionType === 'alert') {
      return { allowed: false, reason: 'Quiet hours - alerts suppressed' };
    }

    return { allowed: true };
  }

  /**
   * Record an action
   */
  recordAction(actionType) {
    this.state.actions_today++;

    if (actionType === 'alert') {
      this.state.alerts_this_hour++;
    }

    return {
      actions_remaining: this.actionLimits.actions_per_day - this.state.actions_today
    };
  }

  /**
   * Record a success (resets failure counter)
   */
  recordSuccess() {
    this.state.consecutive_failures = 0;

    if (this.state.circuit_breaker_open) {
      this.state.circuit_breaker_open = false;
      console.log('[Safety] Circuit breaker closed after success');
    }
  }

  /**
   * Record a failure (may trip circuit breaker)
   */
  recordFailure(error) {
    this.state.consecutive_failures++;

    if (this.state.consecutive_failures >= this.limits.circuit_breaker_threshold) {
      this.state.circuit_breaker_open = true;
      console.error('[Safety] CIRCUIT BREAKER OPENED after', this.state.consecutive_failures, 'failures');
      return { circuit_breaker_open: true };
    }

    return { circuit_breaker_open: false };
  }

  /**
   * Manually reset circuit breaker
   */
  resetCircuitBreaker() {
    this.state.circuit_breaker_open = false;
    this.state.consecutive_failures = 0;
    console.log('[Safety] Circuit breaker manually reset');
  }

  /**
   * Get current safety state
   */
  getState() {
    this._checkDailyReset();
    this._checkHourlyReset();

    return {
      ...this.state,
      quiet_hours: this.isQuietHours(),
      limits: {
        api_calls_per_day: this.actionLimits.api_calls_per_day,
        actions_per_day: this.actionLimits.actions_per_day,
        alerts_per_hour: this.actionLimits.alerts_per_hour,
        max_cost_per_day: this.limits.max_cost_per_day
      }
    };
  }
}

export default SafetyController;
