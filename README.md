# LocalLLM Hub

Unified local LLM infrastructure for M4 Max 36GB.
Consolidates: Exocortex embeddings, emailctl classification, Zoid semantic search, Neocortex processing.

## Components
- **embeddings/** — Unified embedding service (Ollama mxbai-embed-large)
- **triage/** — Task router + urgency classifier
- **transcriber/** — Batch voice memo transcription (whisper.cpp)
- **classifier/** — Email/content classifier (local LLM)
- **search/** — Unified semantic search across all data sources

