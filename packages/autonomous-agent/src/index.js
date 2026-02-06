#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import SafetyController from './safety.js';
import MemoryService from './memory.js';
import ObservationService from './observation.js';
import ReasoningService from './reasoning.js';
import ActionService from './action.js';
import ControlService from './control.js';
import ConsciousnessLoop from './loop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

/**
 * Autonomous Agent System
 * Main entry point
 */

class AutonomousAgent {
  constructor() {
    // Check if agent is enabled
    if (!config.enabled) {
      console.warn('⚠️  Autonomous agent is DISABLED in config');
      console.warn('   This is dormant code. To activate:');
      console.warn('   1. Review all safety controls');
      console.warn('   2. Run dry-run for 24 hours');
      console.warn('   3. Set config.enabled = true');
      process.exit(0);
    }

    // Initialize services
    console.log('🤖 Initializing Autonomous Agent...\n');

    this.safety = new SafetyController();
    console.log('✓ Safety controller initialized');

    this.memory = new MemoryService();
    console.log('✓ Memory service initialized');

    this.observation = new ObservationService(this.memory);
    console.log('✓ Observation service initialized');

    this.reasoning = new ReasoningService(this.safety, this.memory);
    console.log('✓ Reasoning service initialized');

    const dryRun = config.mode === 'dry-run' || process.argv.includes('--dry-run');
    this.action = new ActionService(this.safety, this.memory, dryRun);
    console.log(`✓ Action service initialized (${dryRun ? 'DRY-RUN' : 'LIVE'})`);

    this.loop = new ConsciousnessLoop(
      this.observation,
      this.reasoning,
      this.action,
      this.memory,
      this.safety,
      null // control will be set after creation
    );
    console.log('✓ Consciousness loop initialized');

    this.control = new ControlService(this.loop, this.safety, this.memory);
    this.loop.control = this.control;
    console.log('✓ Control service initialized');

    console.log('\n✅ All services ready\n');
  }

  /**
   * Start the agent
   */
  async start(dryRun = true) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STARTING AUTONOMOUS AGENT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Display configuration
    console.log('Configuration:');
    console.log(`  Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
    console.log(`  Observation interval: ${config.observation.interval_seconds}s`);
    console.log(`  Sources: ${config.observation.sources.join(', ')}`);
    console.log(`  Reasoning tiers: ${config.reasoning.tier1_model} / ${config.reasoning.tier2_model} / ${config.reasoning.tier3_model}`);
    console.log(`  Safety limits:`);
    console.log(`    - Max cost: $${config.safety.max_cost_per_day}/day`);
    console.log(`    - Max API calls: ${config.action.rate_limits.api_calls_per_day}/day`);
    console.log(`    - Max actions: ${config.action.rate_limits.actions_per_day}/day`);
    console.log(`    - Circuit breaker: ${config.safety.circuit_breaker_threshold} failures`);
    console.log(`  Whitelisted actions: ${config.action.whitelist.join(', ')}`);
    console.log(`  Forbidden actions: ${config.action.forbidden.join(', ')}\n`);

    if (dryRun) {
      console.log('⚠️  DRY-RUN MODE');
      console.log('   All actions will be logged but NOT executed\n');
    } else {
      console.log('🔴 LIVE MODE');
      console.log('   Actions WILL be executed!\n');
    }

    // Safety confirmation for live mode
    if (!dryRun) {
      console.log('⚠️  DANGER: Live mode requires explicit confirmation');
      console.log('   To proceed, you must manually review and approve this code');
      console.log('   Exiting for safety...\n');
      process.exit(1);
    }

    // Start control service
    const result = await this.control.start(dryRun);

    if (!result.success) {
      console.error(`✗ Failed to start: ${result.reason}`);
      process.exit(1);
    }

    console.log('✅ Agent started successfully\n');
    console.log('Press Ctrl+C to stop gracefully\n');

    // Setup graceful shutdown
    this._setupShutdownHandlers();
  }

  /**
   * Setup graceful shutdown on SIGINT/SIGTERM
   */
  _setupShutdownHandlers() {
    const shutdown = async (signal) => {
      console.log(`\n\n🛑 Received ${signal}, shutting down gracefully...`);

      try {
        await this.control.stop();
        console.log('✅ Shutdown complete');
        process.exit(0);
      } catch (error) {
        console.error('✗ Shutdown error:', error.message);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Get current status
   */
  getStatus() {
    return this.control.getStatus();
  }

  /**
   * Run health check
   */
  async healthCheck() {
    return await this.control.healthCheck();
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === 'status') {
    // Status check (doesn't start agent)
    const tempAgent = new AutonomousAgent();
    const status = tempAgent.getStatus();
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  } else if (command === 'health') {
    // Health check
    const tempAgent = new AutonomousAgent();
    const health = await tempAgent.healthCheck();
    console.log(JSON.stringify(health, null, 2));
    process.exit(health.status === 'healthy' ? 0 : 1);
  } else {
    // Start agent
    const agent = new AutonomousAgent();
    const dryRun = config.mode === 'dry-run' || process.argv.includes('--dry-run');
    await agent.start(dryRun);
  }
}

export default AutonomousAgent;
