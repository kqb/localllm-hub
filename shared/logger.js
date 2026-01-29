const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function log(level, ...args) {
  if (LOG_LEVELS[level] >= currentLevel) {
    const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
    // errors to stderr, everything else to stdout
    if (level === 'error') {
      console.error(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }
}

module.exports = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
};
