import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

/**
 * Consciousness Loop
 * Main control loop that orchestrates:
 * - Observation (read environment)
 * - Reasoning (decide what to do)
 * - Action (execute decision)
 * - Memory (persist state)
 *
 * Runs continuously at configured interval
 */

class ConsciousnessLoop {
  constructor(observation, reasoning, action, memory, safety, control) {
    this.observation = observation;
    this.reasoning = reasoning;
    this.action = action;
    this.memory = memory;
    this.safety = safety;
    this.control = control;

    this.running = false;
    this.paused = false;
    this.interval = null;
    this.cycleCount = 0;
  }

  /**
   * Start the loop
   */
  start(dryRun = true) {
    if (this.running) {
      console.warn('[Loop] Already running');
      return;
    }

    console.log('[Loop] Starting consciousness loop', dryRun ? '(DRY-RUN)' : '(LIVE)');

    this.running = true;
    this.paused = false;
    this.action.dryRun = dryRun;

    // Start file watchers
    this.observation.startFileWatchers();

    // Run first cycle immediately
    this._cycle();

    // Schedule periodic cycles
    const intervalMs = config.observation.interval_seconds * 1000;
    this.interval = setInterval(() => {
      if (!this.paused) {
        this._cycle();
      }
    }, intervalMs);
  }

  /**
   * Stop the loop (graceful)
   */
  async stop() {
    if (!this.running) {
      return;
    }

    console.log('[Loop] Stopping consciousness loop...');

    this.running = false;
    this.paused = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Stop file watchers
    await this.observation.stop();

    // Final checkpoint
    if (this.memory) {
      this.memory.checkpoint();
    }

    console.log('[Loop] Stopped');
  }

  /**
   * Pause the loop (stop acting, keep monitoring)
   */
  pause() {
    if (!this.running || this.paused) {
      return;
    }

    console.log('[Loop] Pausing...');
    this.paused = true;
  }

  /**
   * Resume the loop
   */
  resume() {
    if (!this.running || !this.paused) {
      return;
    }

    console.log('[Loop] Resuming...');
    this.paused = false;
  }

  /**
   * Emergency kill
   */
  kill() {
    console.log('[Loop] KILLING LOOP');

    this.running = false;
    this.paused = true;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Run one cycle
   */
  async _cycle() {
    const cycleStart = Date.now();
    this.cycleCount++;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 Cycle ${this.cycleCount} - ${new Date().toISOString()}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    try {
      // Phase 1: Observe
      console.log('\n📡 Phase 1: Observation');
      const observations = await this.observation.observe();
      console.log(`   Found ${observations.events.length} events:`, observations.summary);

      // Skip if no important events
      if (observations.events.length === 0) {
        console.log('   ✓ No events - skipping reasoning');
        this._recordCycleSuccess(cycleStart);
        return;
      }

      // Phase 2: Reason
      console.log('\n🧠 Phase 2: Reasoning');
      const decisions = [];

      for (const event of observations.events) {
        const reasoningResult = await this.reasoning.reason(event);
        decisions.push({ event, reasoning: reasoningResult });

        console.log(`   Event: ${event.type} (priority: ${event.priority})`);
        console.log(`   Decision: Tier ${reasoningResult.tier} - ${reasoningResult.decision.action}`);
        console.log(`   Cost: $${reasoningResult.cost.toFixed(4)}`);
      }

      // Phase 3: Act (if not paused)
      if (!this.paused) {
        console.log('\n⚡ Phase 3: Action');

        for (const { event, reasoning } of decisions) {
          const decision = reasoning.decision;

          if (decision.action === 'ignore') {
            console.log(`   Ignoring: ${event.type}`);
            continue;
          }

          const actionResult = await this.action.execute(
            decision.action,
            event.type,
            { event, reasoning: decision }
          );

          console.log(`   Action: ${decision.action} - ${actionResult.success ? '✓' : '✗'}`);
          if (!actionResult.success) {
            console.log(`   Reason: ${actionResult.reason}`);
          }
        }
      } else {
        console.log('\n⏸️  Phase 3: Action (PAUSED)');
        console.log('   Monitoring only - no actions taken');
      }

      // Phase 4: Checkpoint
      if (this.cycleCount % 5 === 0) {
        console.log('\n💾 Phase 4: Checkpoint');
        this.memory.checkpoint();
        console.log('   ✓ State saved');
      }

      this._recordCycleSuccess(cycleStart);

    } catch (error) {
      this._recordCycleError(error, cycleStart);
    }
  }

  /**
   * Record successful cycle
   */
  _recordCycleSuccess(startTime) {
    const duration = Date.now() - startTime;

    this.safety.recordSuccess();
    this.control.incrementCycle();

    console.log(`\n✓ Cycle complete in ${duration}ms`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Update working memory
    this.memory.setWorkingMemory('last_cycle', {
      cycle: this.cycleCount,
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      success: true
    });
  }

  /**
   * Record cycle error
   */
  _recordCycleError(error, startTime) {
    const duration = Date.now() - startTime;

    console.error('\n✗ Cycle failed:', error.message);
    console.error('Stack:', error.stack);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    this.safety.recordFailure(error);
    this.control.recordError(error);
    this.control.incrementCycle();

    // Update working memory
    this.memory.setWorkingMemory('last_cycle', {
      cycle: this.cycleCount,
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      success: false,
      error: error.message
    });

    // Check if circuit breaker opened
    const safetyState = this.safety.getState();
    if (safetyState.circuit_breaker_open) {
      console.error('🚨 CIRCUIT BREAKER OPENED - PAUSING AGENT');
      this.pause();
    }
  }

  /**
   * Get loop stats
   */
  getStats() {
    return {
      running: this.running,
      paused: this.paused,
      cycle_count: this.cycleCount,
      interval_seconds: config.observation.interval_seconds
    };
  }
}

export default ConsciousnessLoop;
