#!/usr/bin/env node
const { Command } = require('commander');
const { transcribe, batchTranscribe } = require('./index');

const program = new Command();

program
  .name('localllm-transcribe')
  .description('Transcribe audio files using whisper.cpp')
  .version('1.0.0');

program
  .command('transcribe <file>')
  .description('Transcribe single audio file')
  .option('-m, --model <model>', 'Whisper model', 'base')
  .option('-l, --language <lang>', 'Language code', 'auto')
  .option('-t, --threads <number>', 'Number of threads')
  .action(async (file, options) => {
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
  .command('batch <directory>')
  .description('Transcribe all audio files in directory')
  .option('-m, --model <model>', 'Whisper model', 'base')
  .option('-l, --language <lang>', 'Language code', 'auto')
  .option('-o, --output <file>', 'Output JSON file')
  .action(async (directory, options) => {
    try {
      const results = await batchTranscribe(directory, options);

      if (options.output) {
        const fs = require('fs');
        fs.writeFileSync(options.output, JSON.stringify(results, null, 2));
        console.log(`Results saved to ${options.output}`);
      } else {
        console.log(JSON.stringify(results, null, 2));
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
