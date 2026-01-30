#!/usr/bin/env node
/**
 * Test script for context-aware routing with conversation history
 */

const { routeToModel } = require('./index');

async function testHistoryRouting() {
  console.log('🧪 Testing Context-Aware Routing\n');

  // Test 1: Ambiguous message without context
  console.log('Test 1: Ambiguous message WITHOUT history');
  console.log('Message: "Fix it"');
  const result1 = await routeToModel('Fix it');
  console.log(`Result: ${result1.route} - ${result1.reason}`);
  console.log(`Priority: ${result1.priority}\n`);

  // Test 2: Same message WITH context
  console.log('Test 2: Same message WITH history');
  console.log('History:');
  console.log('  USER: Run the test suite');
  console.log('  ASSISTANT: Tests failed: 3 errors in auth.ts (line 45, 67, 102)');
  console.log('Message: "Fix it"');
  
  const history = [
    { role: 'user', content: 'Run the test suite' },
    { role: 'assistant', content: 'Tests failed: 3 errors in auth.ts (line 45, 67, 102)' }
  ];
  
  const result2 = await routeToModel('Fix it', history);
  console.log(`Result: ${result2.route} - ${result2.reason}`);
  console.log(`Priority: ${result2.priority}\n`);

  // Test 3: Another ambiguous reference
  console.log('Test 3: File reference with context');
  console.log('History:');
  console.log('  USER: What files import the config module?');
  console.log('  ASSISTANT: Found 12 files: api.ts, auth.ts, db.ts...');
  console.log('Message: "Refactor them to use the new config structure"');
  
  const history2 = [
    { role: 'user', content: 'What files import the config module?' },
    { role: 'assistant', content: 'Found 12 files: api.ts, auth.ts, db.ts, server.ts, routes/index.ts, middleware/auth.ts, utils/logger.ts, models/user.ts, models/session.ts, controllers/api.ts, services/email.ts, lib/cache.ts' }
  ];
  
  const result3 = await routeToModel('Refactor them to use the new config structure', history2);
  console.log(`Result: ${result3.route} - ${result3.reason}`);
  console.log(`Priority: ${result3.priority}\n`);

  // Test 4: Clear non-ambiguous message (should route normally)
  console.log('Test 4: Clear message (no ambiguity)');
  console.log('Message: "Add a search bar component to the dashboard"');
  const result4 = await routeToModel('Add a search bar component to the dashboard');
  console.log(`Result: ${result4.route} - ${result4.reason}`);
  console.log(`Priority: ${result4.priority}\n`);
}

testHistoryRouting().catch(console.error);
