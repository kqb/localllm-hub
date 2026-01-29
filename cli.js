#!/usr/bin/env node
const { Command } = require('commander');

const program = new Command();

program
  .name('localllm')
  .description('Local LLM infrastructure hub')
  .version('1.0.0');

// Embeddings
program
  .command('embed <text>')
  .description('Generate embedding for text')
  .option('-m, --model <model>', 'Embedding model', 'mxbai-embed-large')
  .action(async (text, options) => {
    const { embed } = require('./packages/embeddings');
    try {
      const embedding = await embed(text, options.model);
      console.log(JSON.stringify(embedding));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('batch-embed <texts...>')
  .description('Generate embeddings for multiple texts')
  .option('-m, --model <model>', 'Embedding model', 'mxbai-embed-large')
  .action(async (texts, options) => {
    const { batchEmbed } = require('./packages/embeddings');
    try {
      const embeddings = await batchEmbed(texts, options.model);
      console.log(JSON.stringify(embeddings));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('compare <textA> <textB>')
  .description('Compare similarity between two texts')
  .option('-m, --model <model>', 'Embedding model', 'mxbai-embed-large')
  .action(async (textA, textB, options) => {
    const { compare } = require('./packages/embeddings');
    try {
      const similarity = await compare(textA, textB, options.model);
      console.log(`Similarity: ${similarity.toFixed(4)}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Classifier
program
  .command('classify')
  .description('Classify an email')
  .option('--from <email>', 'From email address', '')
  .option('--subject <subject>', 'Email subject', '')
  .option('--body <body>', 'Email body', '')
  .option('--labels <labels>', 'Comma-separated labels', '')
  .action(async (options) => {
    const { classify } = require('./packages/classifier');
    try {
      const email = {
        from: options.from,
        subject: options.subject,
        body: options.body,
        labels: options.labels ? options.labels.split(',') : []
      };
      const result = await classify(email);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Triage
program
  .command('triage <text>')
  .description('Rate urgency of a message (1-5)')
  .action(async (text) => {
    const { rateUrgency } = require('./packages/triage');
    try {
      const result = await rateUrgency(text);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('route <text>')
  .description('Route task to local or API')
  .action(async (text) => {
    const { routeTask } = require('./packages/triage');
    try {
      const result = await routeTask(text);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Transcriber
program
  .command('transcribe <file>')
  .description('Transcribe audio file')
  .option('-m, --model <model>', 'Whisper model', 'base')
  .option('-l, --language <lang>', 'Language code', 'auto')
  .option('-t, --threads <number>', 'Number of threads')
  .action(async (file, options) => {
    const { transcribe } = require('./packages/transcriber');
    try {
      const result = await transcribe(file, options);
      console.log(result.text);
      console.error(`\n[Transcribed in ${result.duration}ms]`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('transcribe-batch <directory>')
  .description('Transcribe all audio files in directory')
  .option('-m, --model <model>', 'Whisper model', 'base')
  .option('-l, --language <lang>', 'Language code', 'auto')
  .option('-o, --output <file>', 'Output JSON file')
  .action(async (directory, options) => {
    const { batchTranscribe } = require('./packages/transcriber');
    try {
      const results = await batchTranscribe(directory, options);
      if (options.output) {
        require('fs').writeFileSync(options.output, JSON.stringify(results, null, 2));
        console.log(`Results saved to ${options.output}`);
      } else {
        console.log(JSON.stringify(results, null, 2));
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Search
program
  .command('search <query>')
  .description('Semantic search over indexed content')
  .option('-d, --db <path>', 'Database path')
  .option('-k, --top-k <number>', 'Number of results', '5')
  .action(async (query, options) => {
    const { search } = require('./packages/search');
    const { homedir } = require('os');
    const { join } = require('path');
    const dbPath = options.db || join(homedir(), 'clawd/scripts/memory.db');
    try {
      const results = await search(query, dbPath, parseInt(options.topK));
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
  .option('-s, --source <path>', 'Source directory')
  .option('-d, --db <path>', 'Database path')
  .action(async (options) => {
    const { indexDirectory } = require('./packages/search/indexer');
    const config = require('./shared/config');
    const { homedir } = require('os');
    const { join } = require('path');
    const source = options.source || config.paths.memoryDir;
    const dbPath = options.db || join(homedir(), 'clawd/scripts/memory.db');
    try {
      await indexDirectory(source, dbPath);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
