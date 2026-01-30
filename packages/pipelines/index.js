const { emailTriagePipeline } = require('./email-triage');
const { voiceMemoIngestionPipeline } = require('./voice-memo');
const { pipelineHistory, recordPipelineRun } = require('./history');

module.exports = {
  emailTriagePipeline,
  voiceMemoIngestionPipeline,
  pipelineHistory,
  recordPipelineRun,
};
