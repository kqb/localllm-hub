#!/usr/bin/env node
const { Command } = require('commander');
const { search } = require('./index');
const { indexDirectory } = require('./indexer');
const config = require('../../shared/config');
const { homedir } = require('os');
const { join } = require('path');

const program = new Command();
const DEFAULT_DB = join(homedir(), 'clawd/scripts/memory.db');
const DEFAULT_SOURCE = config.paths.memoryDir;

program
  .name('localllm-search')
  .description('Semantic search over indexed content')
  .version('1.0.0');

program
  .command('search <query>')
  .description('Search for content')
  .option('-d, --db <path>', 'Database path', DEFAULT_DB)
  .option('-k, --top-k <number>', 'Number of results', '5')
  .action(async (query, options) => {
    try {
      const results = await search(query, options.db, parseInt(options.topK));

      console.log('\nResults:\n');
      for (const result of results) {
        console.log(`[${result.score.toFixed(3)}] ${result.file}:${result.startLine}-${result.endLine}`);
        console.log(`  ${result.text.slice(0, 200).replace(/\n/g, ' ')}...`);
        console.log();
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('reindex')
  .description('Rebuild search index')
  .option('-s, --source <path>', 'Source directory', DEFAULT_SOURCE)
  .option('-d, --db <path>', 'Database path', DEFAULT_DB)
  .action(async (options) => {
    try {
      await indexDirectory(options.source, options.db);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
