'use strict';

/**
 * Builds XML-structured system prompts for Claude Haiku.
 * Haiku performs dramatically better with XML-tagged prompts.
 */

/**
 * Build Haiku system prompt with XML structure.
 * @param {string} task - Primary task description
 * @param {string[]} constraints - List of constraints/requirements
 * @param {string} outputSchema - Expected output format/schema
 * @returns {string} - XML-structured prompt
 */
function buildHaikuPrompt(task, constraints = [], outputSchema = '') {
  const constraintsXml = constraints.length > 0
    ? `\n<constraints>\n${constraints.map(c => `- ${c}`).join('\n')}\n</constraints>\n`
    : '';

  const schemaXml = outputSchema
    ? `\n<output_schema>\n${outputSchema}\n</output_schema>\n`
    : '';

  return `<system_instruction>
${task}
</system_instruction>${constraintsXml}${schemaXml}`;
}

module.exports = { buildHaikuPrompt };
