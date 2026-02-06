import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

// Import shared Ollama client
const ollamaPath = join(__dirname, '../../../shared/ollama.js');
let ollama;
try {
  const module = await import(ollamaPath);
  ollama = module.default;
} catch (e) {
  console.warn('[Reasoning] Shared Ollama client not available, will use direct fetch');
}

/**
 * Reasoning service for autonomous agent
 * Three-tier decision making:
 * - Tier 1 (Qwen local): Fast triage - "Is this important?"
 * - Tier 2 (Haiku): Quick decisions - "What action?"
 * - Tier 3 (Sonnet/Opus): Deep reasoning - "Why and how?"
 *
 * Cost optimization: 95% Tier 1 (free), 4% Tier 2 ($0.01), 1% Tier 3 ($1-2)
 */

class ReasoningService {
  constructor(safety, memory = null) {
    this.safety = safety;
    this.memory = memory;
    this.models = config.reasoning;
  }

  /**
   * Tier 1: Local triage with Qwen
   * Fast, free, good enough for most decisions
   */
  async tier1Triage(observation) {
    const check = this.safety.canMakeApiCall(1);
    if (!check.allowed) {
      console.warn('[Reasoning] Tier 1 blocked:', check.reason);
      return { important: false, confidence: 0, escalate: false, reason: check.reason };
    }

    try {
      const prompt = this._buildTriagePrompt(observation);

      const response = await this._callOllama(this.models.tier1_model, prompt);

      // Parse response (expecting JSON)
      const decision = this._parseReasoningResponse(response);

      this.safety.recordApiCall(1, 0);
      this.safety.recordSuccess();

      if (this.memory) {
        this.memory.logThought(
          Date.now(),
          1,
          prompt,
          JSON.stringify(decision),
          0
        );
      }

      return decision;
    } catch (error) {
      console.error('[Reasoning] Tier 1 failed:', error.message);
      this.safety.recordFailure(error);

      return {
        important: false,
        confidence: 0,
        escalate: true,
        reason: 'Tier 1 error: ' + error.message
      };
    }
  }

  /**
   * Tier 2: Quick decision with Haiku
   * Cheap, fast, structured output
   */
  async tier2Decision(observation, tier1Result) {
    const check = this.safety.canMakeApiCall(2);
    if (!check.allowed) {
      console.warn('[Reasoning] Tier 2 blocked:', check.reason);
      return { action: 'ignore', confidence: 0, escalate: false, reason: check.reason };
    }

    try {
      const prompt = this._buildDecisionPrompt(observation, tier1Result);

      // TODO: Integrate with Clawdbot gateway for Haiku calls
      // For now, log that we would call Haiku
      console.log('[Reasoning] Tier 2 decision needed (Haiku not integrated yet)');

      const decision = {
        action: 'alert',
        confidence: 0.8,
        escalate: false,
        reason: 'Simulated Haiku decision'
      };

      this.safety.recordApiCall(2, 0.01);
      this.safety.recordSuccess();

      if (this.memory) {
        this.memory.logThought(
          Date.now(),
          2,
          prompt,
          JSON.stringify(decision),
          0.01
        );
      }

      return decision;
    } catch (error) {
      console.error('[Reasoning] Tier 2 failed:', error.message);
      this.safety.recordFailure(error);

      return {
        action: 'ignore',
        confidence: 0,
        escalate: true,
        reason: 'Tier 2 error: ' + error.message
      };
    }
  }

  /**
   * Tier 3: Deep reasoning with Sonnet/Opus
   * Expensive, slow, but thorough
   */
  async tier3Reasoning(observation, tier2Result) {
    const check = this.safety.canMakeApiCall(3);
    if (!check.allowed) {
      console.warn('[Reasoning] Tier 3 blocked:', check.reason);
      return { action: 'defer', confidence: 0, reason: check.reason };
    }

    try {
      const prompt = this._buildDeepReasoningPrompt(observation, tier2Result);

      // TODO: Integrate with Clawdbot gateway for Sonnet/Opus calls
      console.log('[Reasoning] Tier 3 reasoning needed (Sonnet not integrated yet)');

      const decision = {
        action: 'defer',
        confidence: 0.9,
        reasoning: 'Simulated Sonnet deep reasoning',
        plan: 'Wait for user input'
      };

      this.safety.recordApiCall(3, 1);
      this.safety.recordSuccess();

      if (this.memory) {
        this.memory.logThought(
          Date.now(),
          3,
          prompt,
          JSON.stringify(decision),
          1
        );
      }

      return decision;
    } catch (error) {
      console.error('[Reasoning] Tier 3 failed:', error.message);
      this.safety.recordFailure(error);

      return {
        action: 'defer',
        confidence: 0,
        reason: 'Tier 3 error: ' + error.message
      };
    }
  }

  /**
   * Main reasoning pipeline
   */
  async reason(observation) {
    // Tier 1: Is this important?
    const tier1 = await this.tier1Triage(observation);

    if (!tier1.important || tier1.confidence < this.models.tier1_threshold) {
      return {
        tier: 1,
        decision: { action: 'ignore', reason: 'Not important enough' },
        cost: 0
      };
    }

    // Tier 2: What action?
    const tier2 = await this.tier2Decision(observation, tier1);

    if (!tier2.escalate && tier2.confidence >= this.models.tier2_threshold) {
      return {
        tier: 2,
        decision: tier2,
        cost: 0.01
      };
    }

    // Tier 3: Deep reasoning
    const tier3 = await this.tier3Reasoning(observation, tier2);

    return {
      tier: 3,
      decision: tier3,
      cost: 1
    };
  }

  /**
   * Build Tier 1 triage prompt
   */
  _buildTriagePrompt(observation) {
    return `You are a triage agent. Analyze this observation and determine if it's important.

Observation:
${JSON.stringify(observation, null, 2)}

Respond with JSON:
{
  "important": true/false,
  "confidence": 0.0-1.0,
  "escalate": true/false,
  "reason": "brief explanation"
}`;
  }

  /**
   * Build Tier 2 decision prompt
   */
  _buildDecisionPrompt(observation, tier1Result) {
    return `You are a decision agent. Based on this observation and triage result, decide what action to take.

Observation:
${JSON.stringify(observation, null, 2)}

Triage Result:
${JSON.stringify(tier1Result, null, 2)}

Available actions: alert, ignore, escalate, organize_files, commit_memory, update_docs

Respond with JSON:
{
  "action": "action_name",
  "confidence": 0.0-1.0,
  "escalate": true/false,
  "reason": "brief explanation"
}`;
  }

  /**
   * Build Tier 3 deep reasoning prompt
   */
  _buildDeepReasoningPrompt(observation, tier2Result) {
    return `You are a deep reasoning agent. Analyze this complex situation and provide a detailed plan.

Observation:
${JSON.stringify(observation, null, 2)}

Previous Decision:
${JSON.stringify(tier2Result, null, 2)}

Respond with JSON:
{
  "action": "action_name",
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation",
  "plan": "step-by-step plan"
}`;
  }

  /**
   * Call Ollama (Tier 1)
   */
  async _callOllama(model, prompt) {
    if (ollama) {
      // Use shared Ollama client
      const response = await ollama.generate({
        model,
        prompt,
        format: 'json',
        stream: false
      });
      return response.response;
    } else {
      // Direct fetch fallback
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          format: 'json',
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      return data.response;
    }
  }

  /**
   * Parse reasoning response
   */
  _parseReasoningResponse(response) {
    try {
      // Try to parse as JSON
      return JSON.parse(response);
    } catch (e) {
      // Fallback: extract JSON from markdown code block
      const match = response.match(/```json\s*(\{[\s\S]*?\})\s*```/);
      if (match) {
        return JSON.parse(match[1]);
      }

      // Fallback: return safe default
      return {
        important: false,
        confidence: 0,
        escalate: false,
        reason: 'Failed to parse response'
      };
    }
  }
}

export default ReasoningService;
