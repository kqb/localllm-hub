const { readdirSync, existsSync, watchFile, unwatchFile, statSync } = require('fs');
const { join, basename } = require('path');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { initDb, ingestFile } = require('./ingest');

/**
 * Watch sessions directory for JSONL changes and ingest incrementally.
 */
function startWatcher(dbPath, sessionsDir) {
  dbPath = dbPath || config.paths.chatDb;
  sessionsDir = sessionsDir || config.paths.sessionsDir;

  if (!existsSync(sessionsDir)) {
    logger.error(`Sessions directory not found: ${sessionsDir}`);
    process.exit(1);
  }

  const db = initDb(dbPath);
  const debounceTimers = new Map();
  const watchedFiles = new Set();

  function processFile(filePath) {
    ingestFile(db, filePath).catch(err => {
      logger.error(`Watcher error for ${basename(filePath)}: ${err.message}`);
    });
  }

  function watchFileDebounced(filePath) {
    if (watchedFiles.has(filePath)) return;
    watchedFiles.add(filePath);

    watchFile(filePath, { interval: 5000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;

      // Debounce: wait 2s after last change
      if (debounceTimers.has(filePath)) {
        clearTimeout(debounceTimers.get(filePath));
      }

      debounceTimers.set(filePath, setTimeout(() => {
        debounceTimers.delete(filePath);
        logger.info(`Change detected: ${basename(filePath)}`);
        processFile(filePath);
      }, 2000));
    });

    logger.debug(`Watching: ${basename(filePath)}`);
  }

  // Watch existing files
  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    watchFileDebounced(join(sessionsDir, file));
  }

  // Poll for new files every 30s
  const scanInterval = setInterval(() => {
    if (!existsSync(sessionsDir)) return;
    const current = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
    for (const file of current) {
      const fullPath = join(sessionsDir, file);
      if (!watchedFiles.has(fullPath)) {
        logger.info(`New transcript found: ${file}`);
        watchFileDebounced(fullPath);
        processFile(fullPath); // Ingest immediately
      }
    }
  }, 30000);

  logger.info(`Watcher started — monitoring ${files.length} files in ${sessionsDir}`);
  logger.info(`Polling for new files every 30s, debounce 2s`);

  // Graceful shutdown
  function cleanup() {
    logger.info('Watcher stopping...');
    clearInterval(scanInterval);
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    for (const filePath of watchedFiles) {
      unwatchFile(filePath);
    }
    db.close();
    logger.info('Watcher stopped.');
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return { cleanup, db };
}

module.exports = { startWatcher };
