const { existsSync } = require('fs');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { initDb, bufferToEmbedding } = require('./ingest');

/**
 * In-memory vector index for fast similarity search.
 * Preloads all chunk embeddings from SQLite into a contiguous Float32Array matrix.
 * Performs dot-product search on pre-normalized vectors (= cosine similarity).
 *
 * Performance: ~5-20ms per search vs ~800-2000ms with SQLite full-table scan.
 * Memory cost: ~1.5MB for 390 chunks × 1024 dimensions.
 */
class VectorIndex {
  constructor() {
    this.matrix = null;           // Float32Array, row-major [n_chunks × dim]
    this.metadata = [];           // Array of { source, text, meta }
    this.dim = config.embedding?.dimension || 1024;
    this.loaded = false;
    this.loadedAt = 0;
    this.staleAfterMs = 60_000;   // Reload if older than 60s
  }

  /**
   * Load all embeddings from all sources into memory.
   * Called automatically on first search, or manually to refresh.
   */
  load() {
    const startTime = Date.now();
    const chunks = [];
    const Database = require('better-sqlite3');

    // Load from memory.db
    const memoryDbPath = config.paths.searchDb;
    if (existsSync(memoryDbPath)) {
      try {
        const db = new Database(memoryDbPath, { readonly: true });
        const rows = db.prepare('SELECT text, embedding, file, start_line, end_line FROM chunks').all();
        for (const row of rows) {
          chunks.push({
            embedding: bufferToEmbedding(row.embedding),
            source: 'memory',
            text: row.text,
            meta: { file: row.file, startLine: row.start_line, endLine: row.end_line },
          });
        }
        db.close();
        logger.debug(`VectorIndex: loaded ${rows.length} memory chunks`);
      } catch (err) {
        logger.error(`VectorIndex: failed to load memory chunks: ${err.message}`);
      }
    }

    // Load from chat-memory.db (both chat_chunks and telegram_chunks)
    const chatDbPath = config.paths.chatDb;
    if (existsSync(chatDbPath)) {
      try {
        const db = initDb(chatDbPath);

        // Chat chunks
        const hasChatTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_chunks'").get();
        if (hasChatTable) {
          const rows = db.prepare('SELECT text, embedding, session_id, start_ts, end_ts FROM chat_chunks').all();
          for (const row of rows) {
            chunks.push({
              embedding: bufferToEmbedding(row.embedding),
              source: 'chat',
              text: row.text,
              meta: { sessionId: row.session_id, startTs: row.start_ts, endTs: row.end_ts },
            });
          }
          logger.debug(`VectorIndex: loaded ${rows.length} chat chunks`);
        }

        // Telegram chunks
        const hasTelegramTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_chunks'").get();
        if (hasTelegramTable) {
          const rows = db.prepare('SELECT text, embedding, start_ts, end_ts FROM telegram_chunks').all();
          for (const row of rows) {
            chunks.push({
              embedding: bufferToEmbedding(row.embedding),
              source: 'telegram',
              text: row.text,
              meta: { startTs: row.start_ts, endTs: row.end_ts },
            });
          }
          logger.debug(`VectorIndex: loaded ${rows.length} telegram chunks`);
        }

        db.close();
      } catch (err) {
        logger.error(`VectorIndex: failed to load chat/telegram chunks: ${err.message}`);
      }
    }

    // Build contiguous Float32Array matrix
    const n = chunks.length;
    if (n === 0) {
      logger.warn('VectorIndex: no chunks found, index is empty');
      this.matrix = new Float32Array(0);
      this.metadata = [];
      this.loaded = true;
      this.loadedAt = Date.now();
      return;
    }

    this.matrix = new Float32Array(n * this.dim);
    this.metadata = new Array(n);

    for (let i = 0; i < n; i++) {
      const emb = chunks[i].embedding;
      const offset = i * this.dim;

      // Copy embedding into matrix
      for (let j = 0; j < this.dim; j++) {
        this.matrix[offset + j] = emb[j];
      }

      // Pre-normalize row for faster cosine similarity (dot product on unit vectors = cosine)
      let norm = 0;
      for (let j = 0; j < this.dim; j++) {
        norm += this.matrix[offset + j] ** 2;
      }
      norm = Math.sqrt(norm);

      if (norm > 0) {
        for (let j = 0; j < this.dim; j++) {
          this.matrix[offset + j] /= norm;
        }
      }

      // Store metadata
      this.metadata[i] = {
        source: chunks[i].source,
        text: chunks[i].text,
        meta: chunks[i].meta,
      };
    }

    this.loaded = true;
    this.loadedAt = Date.now();

    const loadTime = Date.now() - startTime;
    const memoryMB = (n * this.dim * 4 / 1024 / 1024).toFixed(2);
    logger.info(`VectorIndex loaded: ${n} chunks, ${memoryMB}MB, ${loadTime}ms`);
  }

  /**
   * Search for top-K most similar chunks to query vector.
   *
   * @param {Float64Array|Array} queryVector - Query embedding (1024-dim)
   * @param {number} topK - Number of results to return
   * @param {number} minScore - Minimum similarity score (0-1)
   * @param {string[]|null} sourceFilter - Filter by sources ['memory', 'chat', 'telegram']
   * @returns {Array<{source, text, score, meta}>} Top-K results sorted by score
   */
  search(queryVector, topK, minScore = 0, sourceFilter = null) {
    // Auto-reload if stale or not loaded
    if (!this.loaded || Date.now() - this.loadedAt > this.staleAfterMs) {
      this.load();
    }

    const n = this.metadata.length;
    if (n === 0) {
      return [];
    }

    // Normalize query vector
    const q = new Float32Array(this.dim);
    let qNorm = 0;
    for (let j = 0; j < this.dim; j++) {
      q[j] = queryVector[j];
      qNorm += q[j] ** 2;
    }
    qNorm = Math.sqrt(qNorm);
    for (let j = 0; j < this.dim; j++) {
      q[j] /= qNorm;
    }

    // Compute dot products (= cosine similarity on pre-normalized vectors)
    const scores = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Apply source filter
      if (sourceFilter && !sourceFilter.includes(this.metadata[i].source)) {
        scores[i] = -1;
        continue;
      }

      let dot = 0;
      const offset = i * this.dim;
      for (let j = 0; j < this.dim; j++) {
        dot += q[j] * this.matrix[offset + j];
      }
      scores[i] = dot;
    }

    // Find top-K using indices sort
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => scores[b] - scores[a]);

    const results = [];
    for (let i = 0; i < Math.min(topK, n); i++) {
      const idx = indices[i];
      const score = scores[idx];

      if (score < minScore) break; // Stop once we hit threshold (sorted)

      results.push({
        source: this.metadata[idx].source,
        text: this.metadata[idx].text,
        score,
        meta: this.metadata[idx].meta,
      });
    }

    return results;
  }

  /**
   * Invalidate the index, forcing a reload on next search.
   * Call this after reindexing or ingesting new chunks.
   */
  invalidate() {
    this.loaded = false;
    logger.debug('VectorIndex invalidated');
  }

  /**
   * Get index stats
   */
  getStats() {
    return {
      loaded: this.loaded,
      chunkCount: this.metadata.length,
      loadedAt: this.loadedAt ? new Date(this.loadedAt).toISOString() : null,
      memorySizeMB: this.matrix ? (this.matrix.length * 4 / 1024 / 1024).toFixed(2) : 0,
      sources: this.loaded ? {
        memory: this.metadata.filter(m => m.source === 'memory').length,
        chat: this.metadata.filter(m => m.source === 'chat').length,
        telegram: this.metadata.filter(m => m.source === 'telegram').length,
      } : null,
    };
  }
}

// Singleton instance
const vectorIndex = new VectorIndex();

module.exports = { VectorIndex, vectorIndex };
