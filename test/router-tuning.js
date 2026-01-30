'use strict';

const { routeToModel } = require('../packages/triage');

const TEST_CASES = [
  // Gemini 3 Pro - Strategic planning, deep reasoning, architecture
  { prompt: 'Plan the architecture for a new microservice system', expected: 'gemini_3_pro' },
  { prompt: 'What are the trade-offs between monolith vs microservices for our use case?', expected: 'gemini_3_pro' },
  { prompt: 'Design a data pipeline for real-time analytics at scale', expected: 'gemini_3_pro' },
  { prompt: 'Deeply analyze this codebase and suggest refactoring strategies', expected: 'gemini_3_pro' },
  { prompt: 'Research best practices for distributed system observability', expected: 'gemini_3_pro' },

  // Claude Opus - Critical execution, security, production code
  { prompt: 'Review this auth code for security vulnerabilities before deploy', expected: 'claude_opus' },
  { prompt: 'Audit the payment processing module for PCI compliance', expected: 'claude_opus' },
  { prompt: 'Final review of production deployment scripts', expected: 'claude_opus' },
  { prompt: 'Security analysis of API authentication flow', expected: 'claude_opus' },
  { prompt: 'Critical bug fix for production login system', expected: 'claude_opus' },

  // Claude Sonnet - Standard coding (80% of work)
  { prompt: 'Add a search bar component to the dashboard', expected: 'claude_sonnet' },
  { prompt: 'Fix the bug where form validation fails on empty input', expected: 'claude_sonnet' },
  { prompt: 'Write unit tests for the authentication module', expected: 'claude_sonnet' },
  { prompt: 'Refactor this function to improve readability', expected: 'claude_sonnet' },
  { prompt: 'Implement pagination for the user list', expected: 'claude_sonnet' },
  { prompt: 'Add error handling to the API client', expected: 'claude_sonnet' },
  { prompt: 'Create a new React component for the settings page', expected: 'claude_sonnet' },
  { prompt: 'Debug why the websocket connection keeps dropping', expected: 'claude_sonnet' },

  // Claude Haiku - Quick triage, summarization, simple Q&A
  { prompt: 'Summarize the last 5 git commits', expected: 'claude_haiku' },
  { prompt: 'What does this error message mean?', expected: 'claude_haiku' },
  { prompt: 'Extract the email addresses from this text', expected: 'claude_haiku' },
  { prompt: 'Format this data as a CSV', expected: 'claude_haiku' },
  { prompt: 'Quick triage: is this email urgent?', expected: 'claude_haiku' },

  // Local Qwen - File search, classification, local ops
  { prompt: 'Find all files that import the config module', expected: 'local_qwen' },
  { prompt: 'Search my notes for mentions of the routing project', expected: 'local_qwen' },
  { prompt: 'List all TypeScript files in the src directory', expected: 'local_qwen' },
  { prompt: 'Classify this email: "Meeting reminder for tomorrow"', expected: 'local_qwen' },
  { prompt: 'Find functions that call getUserById', expected: 'local_qwen' },
];

async function runTests() {
  console.log('🧪 Router Tuning Test Suite\n');
  console.log(`Testing ${TEST_CASES.length} prompts...\n`);

  let correct = 0;
  let total = 0;
  const errors = [];

  for (const { prompt, expected } of TEST_CASES) {
    total++;
    try {
      const result = await routeToModel(prompt);
      const pass = result.route === expected;

      if (pass) {
        correct++;
        console.log(`✅ [${expected}] ${prompt.substring(0, 60)}...`);
      } else {
        console.log(`❌ [${expected}] ${prompt.substring(0, 60)}...`);
        console.log(`   Got: ${result.route} (${result.reason})\n`);
        errors.push({ prompt, expected, got: result.route, reason: result.reason });
      }
    } catch (err) {
      console.log(`⚠️  [${expected}] ${prompt.substring(0, 60)}...`);
      console.log(`   Error: ${err.message}\n`);
      errors.push({ prompt, expected, error: err.message });
    }
  }

  const accuracy = ((correct / total) * 100).toFixed(1);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 Results: ${correct}/${total} correct (${accuracy}% accuracy)`);
  console.log(`${'='.repeat(70)}\n`);

  if (errors.length > 0) {
    console.log(`\n❌ Failed cases (${errors.length}):\n`);
    errors.forEach(({ prompt, expected, got, reason, error }) => {
      console.log(`Prompt: ${prompt}`);
      console.log(`Expected: ${expected}`);
      if (error) {
        console.log(`Error: ${error}\n`);
      } else {
        console.log(`Got: ${got}`);
        console.log(`Reason: ${reason}\n`);
      }
    });
  }

  // Exit with code 1 if accuracy below 80%
  if (correct / total < 0.8) {
    console.error('⚠️  Accuracy below 80% threshold. Router prompt needs tuning.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
