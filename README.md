# LocalLLM Hub (v1 - Legacy)

> **⚠️ This is the legacy v1 codebase. Active development has moved to [localllm-hub-v2](../localllm-hub-v2).**

## Why v2?

v1 was a monolithic Python service with custom routing, agent loops, and RAG implementation. v2 rebuilds the entire system on industry-standard frameworks:

- **LangGraph** for agent orchestration (vs custom loops)
- **LlamaIndex** for RAG pipeline (vs custom implementation)
- **LiteLLM** for model routing (vs manual routing)
- **MCP** for tool protocol (vs custom tools)

**Result:** More maintainable, extensible, and production-ready.

## What's Here

This codebase contains the original implementation with:
- Custom embedding service
- Manual task routing
- Basic semantic search
- Email classification
- Transcription pipeline

## Migration

If you're using v1, see the [v2 migration guide](../localllm-hub-v2/MIGRATION.md).

For new projects, **start with v2**: https://github.com/kqb/localllm-hub

## Original Components

- `embeddings/` — Unified embedding service (Ollama mxbai-embed-large)
- `triage/` — Task router + urgency classifier  
- `transcriber/` — Batch voice memo transcription (whisper.cpp)
- `classifier/` — Email/content classifier (local LLM)
- `search/` — Unified semantic search across all data sources

## Archive Status

This codebase is kept for:
- Historical reference
- Comparison benchmarking
- Migration support

Active development: https://github.com/kqb/localllm-hub (v2 branch)

## License

MIT
