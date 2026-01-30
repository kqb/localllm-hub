#!/usr/bin/env node
const { Command } = require('commander');
const { prefetchContext, formatAsMarkdown } = require('./index');

const program = new Command();

program
  .name('localllm-librarian')
  .description('Pre-fetch context for prompt injection')
  .version('1.0.0');

program
  .command('prefetch <query>')
  .description('Pre-fetch context blocks from all sources')
  .option('-k, --top-k <number>', 'Number of results per source', '5')
  .option('-s, --sources <list>', 'Comma-separated sources', 'memory,chat,telegram')
  .option('--include-grep', 'Include keyword grep results', false)
  .option('--grep-path <path>', 'Path to grep (if include-grep)')
  .option('--format <type>', 'Output format: json|markdown', 'json')
  .action(async (query, options) => {
    try {
      const result = await prefetchContext(query, {
        topK: parseInt(options.topK),
        sources: options.sources.split(','),
        includeGrep: options.includeGrep,
        grepPath: options.grepPath,
      });

      if (options.format === 'markdown') {
        console.log(formatAsMarkdown(result.blocks));
        console.error(`\n[Fetched ${result.summary.totalResults} blocks in ${result.summary.queryTime}ms]`);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
