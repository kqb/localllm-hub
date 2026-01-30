const { transcribe } = require('@localllm/transcriber');
const { embed } = require('@localllm/embeddings');
const { search } = require('@localllm/search');
const logger = require('../../shared/logger');
const { recordPipelineRun } = require('./history');
const Database = require('better-sqlite3');
const { homedir } = require('os');
const { join } = require('path');

/**
 * Voice Memo Ingestion Pipeline
 * transcribe → embed → store + optional context retrieval
 *
 * @param {string} audioFile - Path to audio file
 * @param {Object} options - Pipeline options
 * @returns {Promise<Object>} Pipeline result
 */
async function voiceMemoIngestionPipeline(audioFile, options = {}) {
  const startTime = Date.now();
  const {
    dbPath = join(homedir(), 'clawd/scripts/voice-memos.db'),
    retrieveContext = false,
    contextTopK = 3,
  } = options;

  const result = {
    audioFile,
    steps: {},
    timestamp: new Date().toISOString(),
    duration: 0,
  };

  try {
    // Step 1: Transcribe
    logger.debug('[Pipeline] Voice memo: transcribing...');
    const transcribeStart = Date.now();
    const transcription = await transcribe(audioFile, { model: 'base' });
    result.steps.transcribe = {
      text: transcription.text,
      duration: Date.now() - transcribeStart,
      transcribeDuration: transcription.duration,
    };

    // Step 2: Embed
    logger.debug('[Pipeline] Voice memo: generating embedding...');
    const embedStart = Date.now();
    const embedding = await embed(transcription.text);
    result.steps.embed = {
      dimension: embedding.length,
      duration: Date.now() - embedStart,
    };

    // Step 3: Store in database
    logger.debug('[Pipeline] Voice memo: storing...');
    const storeStart = Date.now();
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_memos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }

    const stmt = db.prepare('INSERT INTO voice_memos (file, text, embedding) VALUES (?, ?, ?)');
    const insertResult = stmt.run(audioFile, transcription.text, buffer);

    result.steps.store = {
      id: insertResult.lastInsertRowid,
      duration: Date.now() - storeStart,
    };

    db.close();

    // Step 4: Retrieve context (optional)
    if (retrieveContext) {
      logger.debug('[Pipeline] Voice memo: retrieving context...');
      const contextStart = Date.now();
      try {
        const memoryDb = join(homedir(), 'clawd/scripts/memory.db');
        const relatedMemories = await search(transcription.text, memoryDb, contextTopK);
        result.steps.context = {
          found: relatedMemories.length,
          results: relatedMemories.map(r => ({
            file: r.file,
            score: r.score,
            preview: r.text.slice(0, 100),
          })),
          duration: Date.now() - contextStart,
        };
      } catch (contextError) {
        result.steps.context = {
          error: contextError.message,
          duration: Date.now() - contextStart,
        };
      }
    }

    result.duration = Date.now() - startTime;
    result.success = true;

    await recordPipelineRun('voice-memo', result);

    logger.info(`[Pipeline] Voice memo ingestion completed in ${result.duration}ms`);
    return result;

  } catch (error) {
    result.duration = Date.now() - startTime;
    result.success = false;
    result.error = error.message;

    await recordPipelineRun('voice-memo', result);

    logger.error('[Pipeline] Voice memo ingestion failed:', error);
    throw error;
  }
}

module.exports = { voiceMemoIngestionPipeline };
