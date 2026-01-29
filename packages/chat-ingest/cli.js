#!/usr/bin/env node
const { Command } = require('commander');
const config = require('../../shared/config');

const program = new Command();

program
  .name('localllm-chat-ingest')
  .description('Ingest and search Clawdbot chat transcripts')
  .version('1.0.0');

program
  .command('ingest')
  .description('One-shot: ingest all transcript files')
  .option('-d, --db <path>', 'Database path', config.paths.chatDb)
  .option('-s, --sessions <path>', 'Sessions directory', config.paths.sessionsDir)
  .action(async (options) => {
    try {
      const { ingestAll } = require('./ingest');
      const total = await ingestAll(options.db, options.sessions);
      console.log(`\nDone: ${total} new chunks ingested.`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search chat history')
  .option('-d, --db <path>', 'Database path', config.paths.chatDb)
  .option('-k, --top-k <number>', 'Number of results', '5')
  .action(async (query, options) => {
    try {
      const { chatSearch } = require('./search');
      const results = await chatSearch(query, options.db, parseInt(options.topK));

      console.log('\nChat search results:\n');
      for (const r of results) {
        const ts = r.startTs ? new Date(r.startTs).toLocaleString() : 'unknown';
        console.log(`[${r.score.toFixed(3)}] session:${r.sessionId.slice(0, 8)}  ${ts}`);
        console.log(`  ${r.text.slice(0, 200).replace(/\n/g, ' | ')}...`);
        console.log();
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Start watching for transcript changes')
  .option('-d, --db <path>', 'Database path', config.paths.chatDb)
  .option('-s, --sessions <path>', 'Sessions directory', config.paths.sessionsDir)
  .action((options) => {
    const { startWatcher } = require('./watcher');
    startWatcher(options.db, options.sessions);
  });

program
  .command('status')
  .description('Show ingestion stats')
  .option('-d, --db <path>', 'Database path', config.paths.chatDb)
  .action((options) => {
    const { existsSync } = require('fs');
    const Database = require('better-sqlite3');

    if (!existsSync(options.db)) {
      console.log('No database found. Run "ingest" first.');
      return;
    }

    const db = new Database(options.db);
    const chunkCount = db.prepare('SELECT COUNT(*) as count FROM chat_chunks').get();
    const fileCount = db.prepare('SELECT COUNT(*) as count FROM ingest_progress').get();
    const lastUpdate = db.prepare('SELECT MAX(last_timestamp) as ts FROM ingest_progress').get();
    const sessionCount = db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM chat_chunks').get();

    console.log('\n📊 Chat Ingest Status');
    console.log(`  Files indexed:    ${fileCount.count}`);
    console.log(`  Sessions:         ${sessionCount.count}`);
    console.log(`  Total chunks:     ${chunkCount.count}`);
    console.log(`  Last update:      ${lastUpdate.ts || 'never'}`);
    console.log(`  Database:         ${options.db}`);
    console.log();

    db.close();
  });

program.parse();
