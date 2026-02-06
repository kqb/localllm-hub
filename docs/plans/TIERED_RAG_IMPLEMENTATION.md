# Tiered RAG Sources Implementation

**Status:** ✅ Complete
**Date:** 2026-02-06

## Overview

Implemented weighted RAG sources to prioritize high-quality curated memory notes over noisy chat logs and Telegram conversations.

## Changes Made

### 1. Source Weight Tiers

Added three-tier weighting system to value sources by quality:

```javascript
const SOURCE_WEIGHTS = {
  memory: 1.0,   // Tier 1: Curated notes - highest priority
  chat: 0.7,     // Tier 2: Clawdbot sessions - useful but verbose
  telegram: 0.5, // Tier 3: Raw chat - often noise
};
```

**Rationale:**
- **Memory (1.0):** Hand-curated notes, distilled insights, high signal-to-noise
- **Chat (0.7):** Clawdbot session transcripts - useful context but verbose
- **Telegram (0.5):** Raw chat exports - often off-topic, low relevance

### 2. Aggressive Filtering

Increased minScore threshold from **0.3 → 0.50** (applied to weighted scores).

**Effective raw score requirements:**
- Memory: raw ≥ 0.50 (weight 1.0)
- Chat: raw ≥ 0.71 (weight 0.7)
- Telegram: raw ≥ 1.00 (weight 0.5) — **effectively disabled** unless perfect match

### 3. Implementation Files

#### packages/chat-ingest/unified-search.js
- Added `SOURCE_WEIGHTS` constant
- Modified all three source sections (memory, chat, telegram) to:
  - Calculate `rawScore = cosineSimilarity(queryVector, embedding)`
  - Apply weight: `weightedScore = rawScore * SOURCE_WEIGHTS[source]`
  - Store both `score` (weighted) and `rawScore` in results
- Added source distribution logging: `"RAG: 5 results (memory: 4, chat: 1, telegram: 0)"`

#### packages/chat-ingest/vector-index.js
- Added `SOURCE_WEIGHTS` constant (same as unified-search)
- Modified `search()` method to:
  - Track both `rawScores` and weighted `scores` arrays
  - Apply weights: `scores[i] = dot * SOURCE_WEIGHTS[source]`
  - Return both `score` and `rawScore` in results
- Added source distribution logging to match unified-search

#### packages/context-pipeline/index.js
- Added source distribution logging in both parallel and sequential RAG paths
- Logs format: `"RAG: 5 results (memory: 4, chat: 1, telegram: 0), 20ms"`

#### shared/config.js
- Changed default `minScore: 0.3` → `minScore: 0.50`
- Added `sourceWeights` to `contextPipeline.rag` config
- Updated comments to clarify weights are applied to scores

#### config.local.json
- Updated `minScore: 0.3` → `minScore: 0.50`
- Added `sourceWeights` config matching defaults

## Testing

Test query: `"routing architecture"` (topK=15)

**Results:**
- 15 total results, **all from memory**
- Weighted scores: 0.595 - 0.759
- All passed minScore=0.50 threshold
- Source distribution: `{ memory: 15 }`

**Interpretation:**
- Memory notes have the best semantic relevance
- Chat/telegram either don't have matching content or would need impossibly high raw scores
- The aggressive filtering successfully prioritizes quality over quantity

## Configuration

Users can tune weighting via `config.local.json`:

```json
{
  "contextPipeline": {
    "rag": {
      "minScore": 0.50,
      "sourceWeights": {
        "memory": 1.0,
        "chat": 0.7,
        "telegram": 0.5
      }
    }
  }
}
```

**Tuning guide:**
- **Increase minScore** (0.50 → 0.60) for higher precision, fewer results
- **Decrease minScore** (0.50 → 0.40) for higher recall, more results
- **Adjust weights** to change relative priority (e.g., chat: 0.8 if sessions are high-quality)
- **Disable telegram** by setting weight to 0.0 or removing from sources array

## Benefits

1. **Higher precision:** Only high-quality memory notes surface for most queries
2. **Reduced noise:** Verbose chat transcripts and off-topic Telegram messages filtered out
3. **Transparent scoring:** Both raw and weighted scores logged for debugging
4. **Configurable:** Easy to tune thresholds and weights per environment

## Future Work

- [ ] Add per-query weight overrides (e.g., `unifiedSearch(query, { sourceWeights: {...} })`)
- [ ] Dashboard UI to visualize source distribution over time
- [ ] A/B test different weight configurations
- [ ] Adaptive weights based on feedback (if user corrects RAG misses, lower weights for that source)

## Related

- See `CONTEXT_PIPELINE_OPTIMIZATIONS.md` for full optimization roadmap
- Phase 3 "Route-Aware RAG" already trims sources by routing tier (local vs API)
- This change complements route-aware trimming by adding quality-based weighting
