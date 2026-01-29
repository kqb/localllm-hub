const { execFile } = require('child_process');
const { promisify } = require('util');
const { existsSync, readdirSync, statSync } = require('fs');
const { join, extname } = require('path');
const logger = require('../../shared/logger');

const execFileAsync = promisify(execFile);

const SUPPORTED_FORMATS = ['.m4a', '.wav', '.mp3', '.mp4', '.ogg', '.flac'];

function findWhisperBinary() {
  const candidates = [
    '/usr/local/bin/whisper-cpp',
    '/opt/homebrew/bin/whisper-cpp',
    '/usr/bin/whisper-cpp',
    process.env.WHISPER_CPP_PATH,
  ].filter(Boolean);

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error('whisper.cpp binary not found. Install whisper.cpp or set WHISPER_CPP_PATH');
}

async function transcribe(filePath, options = {}) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  const whisperBinary = options.whisperBinary || findWhisperBinary();
  const model = options.model || 'base';
  const language = options.language || 'auto';

  logger.info(`Transcribing: ${filePath}`);

  const args = ['-m', model, '-f', filePath];

  if (language !== 'auto') {
    args.push('-l', language);
  }

  if (options.threads) {
    args.push('-t', options.threads.toString());
  }

  try {
    const startTime = Date.now();
    const { stdout } = await execFileAsync(whisperBinary, args);
    const duration = Date.now() - startTime;

    const text = stdout
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('['))
      .join(' ')
      .trim();

    return { text, duration };
  } catch (error) {
    logger.error(`Transcription failed: ${error.message}`);
    throw error;
  }
}

async function batchTranscribe(dirPath, options = {}) {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const files = readdirSync(dirPath)
    .filter(f => SUPPORTED_FORMATS.includes(extname(f).toLowerCase()))
    .map(f => join(dirPath, f));

  logger.info(`Found ${files.length} audio files`);

  const results = [];
  for (const file of files) {
    try {
      const result = await transcribe(file, options);
      results.push({ file, ...result });
    } catch (error) {
      logger.error(`Failed to transcribe ${file}: ${error.message}`);
      results.push({ file, text: null, error: error.message });
    }
  }

  return results;
}

module.exports = {
  transcribe,
  batchTranscribe,
  findWhisperBinary,
  SUPPORTED_FORMATS,
};
