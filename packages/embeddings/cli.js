#!/usr/bin/env node
const { Command } = require('commander');
const { embed, batchEmbed, compare } = require('./index');

const program = new Command();

program
  .name('localllm-embed')
  .description('Generate embeddings using Ollama')
  .version('1.0.0');

program
  .command('embed <text>')
  .description('Generate embedding for text')
  .option('-m, --model <model>', 'Embedding model', 'mxbai-embed-large')
  .action(async (text, options) => {
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
    try {
      const similarity = await compare(textA, textB, options.model);
      console.log(`Similarity: ${similarity.toFixed(4)}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
