#!/usr/bin/env node
const { Command } = require('commander');
const { classify } = require('./index');

const program = new Command();

program
  .name('localllm-classify')
  .description('Classify emails using rules + LLM')
  .version('1.0.0');

program
  .command('classify')
  .description('Classify an email')
  .option('--from <email>', 'From email address', '')
  .option('--subject <subject>', 'Email subject', '')
  .option('--body <body>', 'Email body', '')
  .option('--labels <labels>', 'Comma-separated labels', '')
  .action(async (options) => {
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

program.parse();
