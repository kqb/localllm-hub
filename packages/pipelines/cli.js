#!/usr/bin/env node
const { emailTriagePipeline } = require('./email-triage');
const { voiceMemoIngestionPipeline } = require('./voice-memo');
const { pipelineHistory, pipelineStats } = require('./history');

module.exports = {
  async handleEmailTriage(options) {
    const email = {
      from: options.from || '',
      subject: options.subject || '',
      body: options.body || '',
      labels: options.labels ? options.labels.split(',') : [],
    };

    const result = await emailTriagePipeline(email, {
      notifyThreshold: options.threshold || 4,
      onNotify: async (data) => {
        console.log('\n🚨 HIGH URGENCY NOTIFICATION');
        console.log(`  Urgency: ${data.urgency.urgency}/5`);
        console.log(`  Category: ${data.classification.category}`);
        console.log(`  Reasoning: ${data.urgency.reasoning}`);
      },
    });

    console.log(JSON.stringify(result, null, 2));
  },

  async handleVoiceMemo(audioFile, options) {
    const result = await voiceMemoIngestionPipeline(audioFile, {
      retrieveContext: options.context || false,
      contextTopK: options.topK || 3,
    });

    console.log(JSON.stringify(result, null, 2));
  },

  async handleHistory(options) {
    const history = pipelineHistory({
      pipeline: options.pipeline || null,
      limit: options.limit || 50,
    });

    console.log(`\n📊 Pipeline History (${history.length} runs)\n`);

    for (const run of history) {
      const status = run.success ? '✅' : '❌';
      console.log(`${status} ${run.pipeline} - ${new Date(run.timestamp).toLocaleString()}`);
      console.log(`   Duration: ${run.duration}ms`);
      if (!run.success) {
        console.log(`   Error: ${run.result.error}`);
      }
      console.log();
    }
  },

  async handleStats() {
    const stats = pipelineStats();

    console.log('\n📊 Pipeline Statistics\n');

    for (const [pipeline, data] of Object.entries(stats)) {
      console.log(`${pipeline}:`);
      console.log(`  Total runs:    ${data.total}`);
      console.log(`  Successful:    ${data.successful}`);
      console.log(`  Failed:        ${data.failed}`);
      console.log(`  Success rate:  ${data.successRate}%`);
      console.log(`  Avg duration:  ${data.avgDuration}ms`);
      console.log(`  Last run:      ${new Date(data.lastRun).toLocaleString()}`);
      console.log();
    }
  },
};
