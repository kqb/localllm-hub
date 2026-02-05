"use strict";

/**
 * Alert System Module
 *
 * Threshold-based alerts for routing accuracy, memory recall,
 * and overall trust metrics. Sends critical alerts to Telegram
 * via the Clawdbot gateway wake endpoint.
 */

const { execFile } = require("child_process");
const { existsSync, readFileSync, writeFileSync, appendFileSync } = require("fs");
const { join } = require("path");
const logger = require("../../shared/logger");

// Data paths
const DATA_DIR = join(__dirname, "../../data");
const ALERTS_LOG_PATH = join(DATA_DIR, "alerts-log.jsonl");

// ============================================================================
// ALERT THRESHOLDS
// ============================================================================

const THRESHOLDS = {
  // Router metrics
  overrideRate: {
    warn: 0.02,     // 2% - user overriding twice in 100 requests
    critical: 0.05, // 5% - serious trust issue
    description: "Rate of user-requested route overrides",
  },
  autoEscalationRate: {
    warn: 0.20,     // 20% - router is under-routing
    critical: 0.35, // 35% - router needs retraining
    description: "Rate of automatic escalations to higher tiers",
  },
  avgConfidence: {
    warn: 0.70,     // 70% - router is uncertain
    critical: 0.55, // 55% - router is guessing
    inverted: true, // Lower is worse
    description: "Average router confidence score",
  },

  // Memory metrics
  memoryMissRate: {
    warn: 0.15,     // 15% - missing info 1 in 7 times
    critical: 0.25, // 25% - missing info 1 in 4 times
    description: "Rate of memory recall failures",
  },
  herdingAvg: {
    warn: 2.5,      // User correcting 2-3 times on average
    critical: 4.0,  // User correcting 4+ times - severe frustration
    description: "Average messages before agent recalls correctly",
  },

  // Trust metrics
  trustScore: {
    warn: 60,       // Trust eroding
    critical: 40,   // Critical trust failure
    inverted: true, // Lower is worse
    description: "Composite trust score (0-100)",
  },
};

// Cooldown tracking (prevent alert spam)
const alertCooldowns = new Map();
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between same alerts

// ============================================================================
// ALERT CHECKING
// ============================================================================

/**
 * Check all metrics against thresholds and generate alerts.
 * @param {object} metrics - Current metrics
 * @returns {Array<{level: string, metric: string, value: number, threshold: number, message: string, action: string}>}
 */
function checkAlerts(metrics) {
  const alerts = [];
  const now = Date.now();

  for (const [metricName, config] of Object.entries(THRESHOLDS)) {
    const value = metrics[metricName];
    if (value === undefined || value === null) continue;

    let level = null;
    let threshold = null;

    if (config.inverted) {
      // Lower values are worse (e.g., confidence, trust score)
      if (value < config.critical) {
        level = "critical";
        threshold = config.critical;
      } else if (value < config.warn) {
        level = "warn";
        threshold = config.warn;
      }
    } else {
      // Higher values are worse (e.g., miss rate, herding)
      if (value > config.critical) {
        level = "critical";
        threshold = config.critical;
      } else if (value > config.warn) {
        level = "warn";
        threshold = config.warn;
      }
    }

    if (level) {
      // Check cooldown
      const cooldownKey = `${metricName}:${level}`;
      const lastAlert = alertCooldowns.get(cooldownKey);
      if (lastAlert && now - lastAlert < COOLDOWN_MS) {
        continue; // Skip, still in cooldown
      }

      const isPercent = metricName.includes("Rate");
      const displayValue = isPercent
        ? `${(value * 100).toFixed(1)}%`
        : value.toFixed(2);
      const displayThreshold = isPercent
        ? `${(threshold * 100).toFixed(1)}%`
        : threshold.toFixed(2);

      alerts.push({
        level,
        metric: metricName,
        value,
        threshold,
        message: `${config.description}: ${displayValue} (threshold: ${displayThreshold})`,
        action: getRecommendedAction(metricName, level),
        timestamp: new Date().toISOString(),
      });

      // Update cooldown
      alertCooldowns.set(cooldownKey, now);
    }
  }

  return alerts;
}

/**
 * Get recommended action for an alert.
 * @param {string} metric - Metric name
 * @param {string} level - Alert level
 * @returns {string} Recommended action
 */
function getRecommendedAction(metric, level) {
  const actions = {
    overrideRate: {
      warn: "Review recent routing decisions. Check if router prompt needs adjustment.",
      critical: "Router trust critically low. Review router-failures.jsonl and retrain router prompt.",
    },
    autoEscalationRate: {
      warn: "Router may be under-routing. Consider adjusting complexity thresholds.",
      critical: "Router consistently underestimating complexity. Review escalation signals.",
    },
    avgConfidence: {
      warn: "Router uncertainty high. Add more examples to router prompt.",
      critical: "Router effectively guessing. Immediate prompt engineering needed.",
    },
    memoryMissRate: {
      warn: "Memory recall degrading. Run index-project-docs.sh and check RAG pipeline.",
      critical: "Memory recall failing. Reindex all sources, verify embedding model.",
    },
    herdingAvg: {
      warn: "User having to correct agent frequently. Review memory verification.",
      critical: "Agent requires excessive correction. Audit recent conversations.",
    },
    trustScore: {
      warn: "Trust eroding. Review recent failures and implement corrections.",
      critical: "Critical trust failure. Immediate review of all subsystems required.",
    },
  };

  return actions[metric]?.[level] || "Investigate metric and take corrective action.";
}

/**
 * Log an alert event.
 * @param {object} alert - Alert data
 */
function logAlert(alert) {
  const entry = {
    timestamp: alert.timestamp || new Date().toISOString(),
    ...alert,
    logged: true,
  };

  try {
    appendFileSync(ALERTS_LOG_PATH, JSON.stringify(entry) + "\n");
    logger.warn(`Alert [${alert.level}] ${alert.metric}: ${alert.message}`);
  } catch (err) {
    logger.error(`Failed to log alert: ${err.message}`);
  }
}

/**
 * Send critical alert to Telegram via Clawdbot gateway.
 * Uses the `clawdbot wake` command to send a message.
 * @param {object} alert - Alert data
 * @returns {Promise<boolean>} Success status
 */
async function sendTelegramAlert(alert) {
  return new Promise((resolve) => {
    const message = [
      `\u26a0\ufe0f **${alert.level.toUpperCase()} ALERT**`,
      `**Metric:** ${alert.metric}`,
      `**Value:** ${typeof alert.value === "number" && alert.metric.includes("Rate") ? (alert.value * 100).toFixed(1) + "%" : alert.value}`,
      `**Message:** ${alert.message}`,
      `**Action:** ${alert.action}`,
    ].join("\n");

    execFile("clawdbot", ["wake", "--message", message], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        logger.error(`Failed to send Telegram alert: ${err.message}`);
        // Fallback: try direct gateway HTTP call
        sendAlertViaHTTP(alert).then(resolve);
        return;
      }
      logger.info(`Telegram alert sent: ${alert.metric}`);
      resolve(true);
    });
  });
}

/**
 * Fallback: Send alert via HTTP to Clawdbot gateway.
 * @param {object} alert - Alert data
 * @returns {Promise<boolean>} Success status
 */
async function sendAlertViaHTTP(alert) {
  try {
    const response = await fetch("http://127.0.0.1:18789/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        message: `[${alert.level.toUpperCase()}] ${alert.metric}: ${alert.message}`,
        priority: alert.level === "critical" ? "high" : "normal",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      logger.info(`HTTP alert sent: ${alert.metric}`);
      return true;
    }
    logger.warn(`HTTP alert failed: ${response.status}`);
    return false;
  } catch (err) {
    logger.error(`HTTP alert error: ${err.message}`);
    return false;
  }
}

/**
 * Process alerts: log all, send critical ones to Telegram.
 * @param {Array} alerts - Array of alerts from checkAlerts()
 * @returns {Promise<void>}
 */
async function processAlerts(alerts) {
  for (const alert of alerts) {
    logAlert(alert);

    if (alert.level === "critical") {
      await sendTelegramAlert(alert);
    }
  }
}

/**
 * Get recent alerts for dashboard display.
 * @param {number} [limit=20] - Max alerts to return
 * @returns {Array} Recent alerts
 */
function getRecentAlerts(limit = 20) {
  try {
    if (!existsSync(ALERTS_LOG_PATH)) {
      return [];
    }

    const lines = readFileSync(ALERTS_LOG_PATH, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);

    return lines
      .slice(-limit)
      .reverse()
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    logger.error(`Failed to read alerts: ${err.message}`);
    return [];
  }
}

/**
 * Clear cooldowns (for testing or manual reset).
 */
function clearCooldowns() {
  alertCooldowns.clear();
}

module.exports = {
  // Configuration
  THRESHOLDS,
  // Core functions
  checkAlerts,
  processAlerts,
  logAlert,
  // Notification
  sendTelegramAlert,
  sendAlertViaHTTP,
  // Dashboard
  getRecentAlerts,
  // Utilities
  getRecommendedAction,
  clearCooldowns,
};
