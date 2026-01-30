#!/usr/bin/env bash
# Keeps qwen2.5:7b router model loaded in Ollama by sending tiny prompts every 30min

set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
MODEL="${ROUTER_MODEL:-qwen2.5:7b}"
KEEP_ALIVE="60m"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

# Send a tiny prompt to keep the model loaded
warm_model() {
  log "Warming $MODEL (keep_alive=$KEEP_ALIVE)..."

  curl -s -X POST "$OLLAMA_URL/api/generate" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$MODEL\",
      \"prompt\": \"hi\",
      \"stream\": false,
      \"keep_alive\": \"$KEEP_ALIVE\"
    }" > /dev/null

  if [ $? -eq 0 ]; then
    log "✓ $MODEL is warm"
  else
    log "✗ Failed to warm $MODEL"
    exit 1
  fi
}

warm_model
