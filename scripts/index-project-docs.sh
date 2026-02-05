#!/bin/bash
# ============================================================================
# Project Documentation Indexer
#
# Indexes README.md, CLAUDE.md, ARCHITECTURE.md and other key documentation
# files from known project directories into the semantic search database.
#
# Purpose: Ensures the agent's memory contains up-to-date project context
# so it can recall established systems and workflows without manual prompting.
#
# Usage:
#   ./index-project-docs.sh           # Index all projects
#   ./index-project-docs.sh --dry-run # Show what would be indexed
#
# Cron:
#   0 */6 * * * ~/Projects/localllm-hub/scripts/index-project-docs.sh
# ============================================================================

set -euo pipefail

# Configuration
LOCALLLM_DIR="${HOME}/Projects/localllm-hub"
MEMORY_DIR="${HOME}/clawd/memory"
SEARCH_DB="${HOME}/clawd/scripts/memory.db"
LOG_FILE="${HOME}/.clawdbot/logs/index-project-docs.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Projects to index (name=path)
declare -A PROJECTS=(
  ["live-translation-local"]="${HOME}/Documents/live-translation-local"
  ["localllm-hub"]="${HOME}/Projects/localllm-hub"
  ["localllm-hub-v2"]="${HOME}/Projects/localllm-hub-v2"
  ["relationship-os"]="${HOME}/clawd/relationship-os"
  ["cascade-multiagent"]="${HOME}/Projects/cascade-multiagent"
  ["agent-orchestra"]="${HOME}/Projects/agent-orchestra"
  ["exocortex"]="${HOME}/.exocortex"
  ["clawdbot"]="${HOME}/clawd"
)

# Documentation files to index per project
DOC_FILES=(
  "README.md"
  "CLAUDE.md"
  "ARCHITECTURE.md"
  "CONTRIBUTING.md"
  "CHANGELOG.md"
  "AGENTS.md"
  "SOUL.md"
  "TOOLS.md"
  "INTEGRATION.md"
)

# Check for dry-run mode
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  log "DRY RUN MODE - no changes will be made"
fi

log "========================================="
log "Project Documentation Indexer"
log "========================================="

# Check if indexer is available
INDEXER_CMD="node ${LOCALLLM_DIR}/cli.js reindex"
if ! command -v node &> /dev/null; then
  log "ERROR: Node.js not found"
  exit 1
fi

# Create a temporary directory for project docs
TEMP_DIR="${MEMORY_DIR}/project-docs"
mkdir -p "$TEMP_DIR"

# Track indexed files
INDEXED_COUNT=0
SKIPPED_COUNT=0

# Index each project's documentation
for project in "${!PROJECTS[@]}"; do
  dir="${PROJECTS[$project]}"

  if [[ ! -d "$dir" ]]; then
    log "SKIP: $project - directory not found: $dir"
    ((SKIPPED_COUNT++))
    continue
  fi

  log "PROJECT: $project ($dir)"

  for doc in "${DOC_FILES[@]}"; do
    doc_path="${dir}/${doc}"

    if [[ -f "$doc_path" ]]; then
      # Create a tagged copy in memory directory for indexing
      tagged_name="${project}-${doc}"
      target_path="${TEMP_DIR}/${tagged_name}"

      log "  FOUND: $doc"

      if [[ "$DRY_RUN" == "false" ]]; then
        # Copy with project header for context
        {
          echo "# Project: ${project}"
          echo "# Source: ${doc_path}"
          echo "# Last Updated: $(date -r "$doc_path" '+%Y-%m-%d %H:%M:%S')"
          echo ""
          cat "$doc_path"
        } > "$target_path"

        ((INDEXED_COUNT++))
      fi
    fi
  done
done

log "-----------------------------------------"
log "Found $INDEXED_COUNT documentation files"
log "Skipped $SKIPPED_COUNT projects (not found)"

# Run the indexer on the project-docs directory
if [[ "$DRY_RUN" == "false" && "$INDEXED_COUNT" -gt 0 ]]; then
  log "Running semantic indexer..."

  # Use the localllm-hub reindex command with the project-docs source
  cd "$LOCALLLM_DIR"

  if node cli.js reindex --source "$TEMP_DIR" --db "$SEARCH_DB" 2>&1 | tee -a "$LOG_FILE"; then
    log "Indexing complete"
  else
    log "ERROR: Indexing failed"
    exit 1
  fi
fi

log "========================================="
log "Done at $(date '+%Y-%m-%d %H:%M:%S')"
log "========================================="
