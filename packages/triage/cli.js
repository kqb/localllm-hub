#!/usr/bin/env node
const { Command } = require('commander');
const { rateUrgency, routeTask } = require('./index');

const program = new Command();

program
  .name('localllm-triage')
  .description('Triage tasks and rate urgency')
  .version('1.0.0');

program
  .command('urgency <text>')
  .description('Rate urgency of a message (1-5)')
  .action(async (text) => {
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
    try {
      const result = await routeTask(text);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
