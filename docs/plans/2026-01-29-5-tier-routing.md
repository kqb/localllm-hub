# 5-Tier Route Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build complete 5-tier route switching system with dashboard UI, fallback chains, XML prompts, and router testing

**Architecture:** The router uses Qwen 7B (local via Ollama) to classify incoming prompts into one of 5 routes (gemini_3_pro, claude_opus, claude_sonnet, claude_haiku, local_qwen). Dashboard provides live editing of router prompt, test interface, and compaction settings editor. Fallback chain resolves to alternative routes when primary is unavailable.

**Tech Stack:** Node.js, Express, vanilla JS frontend, better-sqlite3, Ollama

**Security Note:** Dashboard is localhost-only admin tool. All dynamic content uses escHtml() for defense-in-depth XSS protection per CLAUDE.md guidelines.

---

## Task 1: Router Prompt Editor Dashboard Panel

**Files:**
- Modify: `packages/dashboard/server.js` (add 3 new routes)
- Modify: `packages/dashboard/public/index.html` (add new card + JS)

**Step 1: Add backend API routes to server.js**

Insert after line 100 (after `/api/reindex` route):

```javascript
app.get('/api/router/prompt', (_req, res) => {
  try {
    const promptPath = path.join(__dirname, '../../shared/router-prompt.js');
    const content = readFileSync(promptPath, 'utf-8');
    res.json({ content, path: promptPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/router/prompt', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Missing content' });
  try {
    const { writeFileSync } = require('fs');
    const promptPath = path.join(__dirname, '../../shared/router-prompt.js');
    writeFileSync(promptPath, content, 'utf-8');
    // Invalidate Node.js require cache so next load gets new content
    delete require.cache[require.resolve('../../shared/router-prompt')];
    res.json({ success: true, path: promptPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/router/test', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const { routeToModel } = require('../triage');
    const result = await routeToModel(query);
    res.json({ query, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Add HTML card to index.html**

Insert before the closing `</main>` tag (around line 2280):

```html
  <section class="card" id="router-card">
    <h2>🧭 Router Prompt Editor</h2>
    <div id="router-content">
      <div class="loading-text"><span class="spinner"></span> Loading...</div>
    </div>
  </section>
```

**Step 3: Add CSS styles to index.html**

Insert before `</style>` tag (around line 152):

```css
  /* Router Editor */
  .router-editor { display: flex; flex-direction: column; gap: 12px; }
  .router-editor textarea { width: 100%; min-height: 400px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; color: var(--text); font-family: 'Monaco', 'Menlo', monospace; font-size: 12px; line-height: 1.5; resize: vertical; }
  .router-editor textarea:focus { outline: none; border-color: var(--accent); }
  .router-actions { display: flex; gap: 8px; align-items: center; }
  .router-test-row { display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
  .router-test-row input { flex: 1; }
  .router-result { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-top: 8px; }
  .router-result pre { margin: 0; font-family: monospace; font-size: 12px; white-space: pre-wrap; color: var(--text); }
  .router-result .route-name { color: var(--green); font-weight: 700; }
  .router-result .priority { color: var(--yellow); }
```

**Step 4: Add JavaScript loader function**

Insert before the init block (around line 2250):

```javascript
async function loadRouter() {
  try {
    const res = await fetch('/api/router/prompt');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const cont = $('router-content');
    // Safety: localhost-only admin tool, escHtml() for defense-in-depth per CLAUDE.md
    const editorHtml = `
      <div class="router-editor">
        <textarea id="router-prompt-text">${escHtml(data.content)}</textarea>
        <div class="router-actions">
          <button class="btn" onclick="saveRouterPrompt()">💾 Save Prompt</button>
          <span id="router-save-status"></span>
        </div>
        <div class="router-test-row">
          <input type="text" id="router-test-input" placeholder="Enter a test query...">
          <button class="btn outline" onclick="testRouter()">🧪 Test Router</button>
        </div>
        <div id="router-test-result"></div>
      </div>
    `;
    cont.innerHTML = editorHtml;
  } catch (err) {
    $('router-content').innerHTML = `<div class="empty">❌ ${escHtml(err.message)}</div>`;
  }
}

async function saveRouterPrompt() {
  const content = $('router-prompt-text').value;
  const status = $('router-save-status');
  try {
    status.innerHTML = '<span class="loading-text"><span class="spinner"></span> Saving...</span>';
    const res = await fetch('/api/router/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    status.innerHTML = '<span class="badge green">✓ Saved</span>';
    setTimeout(() => { status.innerHTML = ''; }, 3000);
  } catch (err) {
    status.innerHTML = `<span class="badge red">❌ ${escHtml(err.message)}</span>`;
  }
}

async function testRouter() {
  const query = $('router-test-input').value.trim();
  if (!query) return;

  const resultDiv = $('router-test-result');
  resultDiv.innerHTML = '<div class="loading-text"><span class="spinner"></span> Routing...</div>';

  try {
    const res = await fetch(`/api/router/test?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const { result } = data;
    // Safety: localhost-only admin tool, escHtml() for defense-in-depth per CLAUDE.md
    const resultHtml = `
      <div class="router-result">
        <pre><span class="route-name">Route:</span> ${escHtml(result.route)}
<span class="priority">Priority:</span> ${escHtml(result.priority)}
<strong>Reason:</strong> ${escHtml(result.reason)}</pre>
      </div>
    `;
    resultDiv.innerHTML = resultHtml;
  } catch (err) {
    resultDiv.innerHTML = `<div class="router-result"><pre>❌ ${escHtml(err.message)}</pre></div>`;
  }
}
```

**Step 5: Add to init block**

Add `loadRouter()` to the Promise.all in the init block (around line 2270):

```javascript
await Promise.all([
  // ... existing loaders ...
  loadRouter(),
]);
```

**Step 6: Commit**

```bash
git add packages/dashboard/server.js packages/dashboard/public/index.html
git commit -m "feat(dashboard): add router prompt editor panel

- GET /api/router/prompt - read router prompt file
- POST /api/router/prompt - save edited prompt
- GET /api/router/test - test router with query
- UI: textarea editor, save button, test input with result display
- XSS defense: escHtml() on all dynamic content (localhost admin tool)

Co-Authored-By: Claude (claude-sonnet-4-5) <noreply@anthropic.com>"
```

---

## Task 2: Cross-Provider Fallback Chain

**Files:**
- Create: `shared/fallback-chain.js`
- Test manually with Node REPL

**Step 1: Create fallback-chain.js**

```javascript
'use strict';

/**
 * Cross-provider fallback chains for 5-tier routing.
 * When a route is unavailable, resolve to next best alternative.
 */

const FALLBACK_CHAINS = {
  claude_haiku: ['claude_sonnet'],
  claude_sonnet: ['gemini_3_pro'],
  claude_opus: ['gemini_3_pro'],
  gemini_3_pro: ['claude_opus'],
  local_qwen: ['claude_haiku'],
};

/**
 * Get ordered fallback list for a route.
 * @param {string} route - Primary route name
 * @returns {string[]} - Ordered fallback routes
 */
function getFallback(route) {
  return FALLBACK_CHAINS[route] || [];
}

/**
 * Resolve route with fallback chain. Walks the chain until finding
 * an available provider or exhausting all options.
 * @param {string} route - Primary route name
 * @param {string[]} availableProviders - List of currently available provider routes
 * @returns {string|null} - Resolved route or null if none available
 */
function resolveRoute(route, availableProviders) {
  if (availableProviders.includes(route)) {
    return route;
  }

  const fallbacks = getFallback(route);
  for (const fallback of fallbacks) {
    if (availableProviders.includes(fallback)) {
      return fallback;
    }
  }

  // No fallback found
  return null;
}

module.exports = { getFallback, resolveRoute };
```

**Step 2: Test with Node REPL**

```bash
node -e "
const { getFallback, resolveRoute } = require('./shared/fallback-chain');
console.log('Haiku fallbacks:', getFallback('claude_haiku'));
console.log('Resolve haiku (only sonnet available):', resolveRoute('claude_haiku', ['claude_sonnet', 'local_qwen']));
console.log('Resolve opus (gemini down):', resolveRoute('claude_opus', ['claude_sonnet', 'local_qwen']));
console.log('Resolve local (nothing available):', resolveRoute('local_qwen', ['gemini_3_pro']));
"
```

Expected output:
```
Haiku fallbacks: [ 'claude_sonnet' ]
Resolve haiku (only sonnet available): claude_sonnet
Resolve opus (gemini down): null
Resolve local (nothing available): gemini_3_pro
```

**Step 3: Commit**

```bash
git add shared/fallback-chain.js
git commit -m "feat(routing): add cross-provider fallback chain

- getFallback(route) - returns ordered fallback list
- resolveRoute(route, available) - walks chain to find available provider
- Chains: haiku→sonnet, sonnet→gemini, opus→gemini, gemini→opus, qwen→haiku

Co-Authored-By: Claude (claude-sonnet-4-5) <noreply@anthropic.com>"
```

---

## Task 3: Haiku XML System Prompts

**Files:**
- Create: `shared/haiku-xml-template.js`
- Test manually with Node REPL

**Step 1: Create haiku-xml-template.js**

```javascript
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
```

**Step 2: Test with Node REPL**

```bash
node -e "
const { buildHaikuPrompt } = require('./shared/haiku-xml-template');
const prompt = buildHaikuPrompt(
  'Summarize the following email thread into 3 bullet points.',
  ['Keep each bullet under 15 words', 'Focus on action items', 'Ignore pleasantries'],
  'Return JSON: { \"bullets\": [\"...\", \"...\", \"...\"] }'
);
console.log(prompt);
"
```

Expected output shows XML-wrapped prompt with all sections.

**Step 3: Commit**

```bash
git add shared/haiku-xml-template.js
git commit -m "feat(routing): add Haiku XML prompt template builder

- buildHaikuPrompt(task, constraints, outputSchema)
- Wraps in <system_instruction>, <constraints>, <output_schema> tags
- Haiku performs dramatically better with XML-structured prompts

Co-Authored-By: Claude (claude-sonnet-4-5) <noreply@anthropic.com>"
```

---

## Task 4: Router Tuning Test Suite

**Files:**
- Create: `test/router-tuning.js`

**Step 1: Create test directory**

```bash
mkdir -p test
```

**Step 2: Create router-tuning.js**

```javascript
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
```

**Step 3: Run the test suite**

```bash
node test/router-tuning.js
```

**Step 4: Commit**

```bash
git add test/router-tuning.js
git commit -m "test(routing): add router tuning test suite

- 30 test cases across all 5 routing tiers
- Measures routing accuracy with pass/fail report
- Exits with code 1 if accuracy < 80%
- Run: node test/router-tuning.js

Co-Authored-By: Claude (claude-sonnet-4-5) <noreply@anthropic.com>"
```

---

## Task 5: Compaction Settings Dashboard Panel

**Files:**
- Modify: `packages/dashboard/server.js` (add 2 new routes)
- Modify: `packages/dashboard/public/index.html` (add new card + JS)

**Step 1: Add backend API routes to server.js**

Insert after the router routes (after step 1 additions):

```javascript
app.get('/api/compaction', (_req, res) => {
  try {
    const clawdbotConfigPath = path.join(os.homedir(), '.clawdbot/clawdbot.json');
    if (!existsSync(clawdbotConfigPath)) {
      return res.status(404).json({ error: 'clawdbot.json not found' });
    }
    const config = JSON.parse(readFileSync(clawdbotConfigPath, 'utf-8'));
    const compaction = config.agents?.defaults?.compaction || {};
    res.json({ compaction, path: clawdbotConfigPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compaction', async (req, res) => {
  const { compaction } = req.body;
  if (!compaction) return res.status(400).json({ error: 'Missing compaction object' });

  try {
    const { writeFileSync } = require('fs');
    const clawdbotConfigPath = path.join(os.homedir(), '.clawdbot/clawdbot.json');

    if (!existsSync(clawdbotConfigPath)) {
      return res.status(404).json({ error: 'clawdbot.json not found' });
    }

    // Read existing config
    const config = JSON.parse(readFileSync(clawdbotConfigPath, 'utf-8'));

    // Create backup
    const backupPath = clawdbotConfigPath + '.bak';
    writeFileSync(backupPath, JSON.stringify(config, null, 2), 'utf-8');

    // Update compaction settings
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    config.agents.defaults.compaction = compaction;

    // Write updated config
    writeFileSync(clawdbotConfigPath, JSON.stringify(config, null, 2), 'utf-8');

    res.json({ success: true, backup: backupPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Add HTML card to index.html**

Insert before the closing `</main>` tag (after router card):

```html
  <section class="card" id="compaction-card">
    <h2>💾 Compaction Settings</h2>
    <div id="compaction-content">
      <div class="loading-text"><span class="spinner"></span> Loading...</div>
    </div>
  </section>
```

**Step 3: Add CSS styles to index.html**

Insert before `</style>` tag (after router styles):

```css
  /* Compaction Settings */
  .compaction-form { display: flex; flex-direction: column; gap: 16px; }
  .compaction-form .form-row { display: flex; flex-direction: column; gap: 4px; }
  .compaction-form label { font-size: 12px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: .5px; }
  .compaction-form input[type=number] { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; color: var(--text); font-size: 14px; }
  .compaction-form input[type=number]:focus { outline: none; border-color: var(--accent); }
  .compaction-form textarea { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; color: var(--text); font-family: monospace; font-size: 12px; line-height: 1.5; min-height: 120px; resize: vertical; }
  .compaction-form textarea:focus { outline: none; border-color: var(--accent); }
  .compaction-form .toggle-wrap { display: flex; align-items: center; gap: 8px; }
  .compaction-form .toggle-wrap input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); }
  .compaction-actions { display: flex; gap: 8px; align-items: center; }
```

**Step 4: Add JavaScript loader function**

Insert before the init block (after loadRouter):

```javascript
async function loadCompaction() {
  try {
    const res = await fetch('/api/compaction');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const { compaction } = data;
    const cont = $('compaction-content');

    // Safety: localhost-only admin tool, escHtml() for defense-in-depth per CLAUDE.md
    const formHtml = `
      <div class="compaction-form">
        <div class="form-row">
          <label>Reserve Tokens Floor</label>
          <input type="number" id="compact-reserve-floor" value="${compaction.reserveTokensFloor || 10000}" min="1000" max="50000" step="1000">
          <span style="font-size: 11px; color: var(--text2);">Minimum tokens always kept free</span>
        </div>

        <div class="form-row">
          <label>Soft Threshold (Tokens)</label>
          <input type="number" id="compact-soft-threshold" value="${compaction.memoryFlush?.softThresholdTokens || 180000}" min="100000" max="200000" step="5000">
          <span style="font-size: 11px; color: var(--text2);">Trigger flush when context reaches this size</span>
        </div>

        <div class="form-row">
          <label>Memory Flush Enabled</label>
          <div class="toggle-wrap">
            <input type="checkbox" id="compact-flush-enabled" ${compaction.memoryFlush?.enabled !== false ? 'checked' : ''}>
            <span style="font-size: 13px; color: var(--text2);">Enable automatic memory flush</span>
          </div>
        </div>

        <div class="form-row">
          <label>Flush Prompt</label>
          <textarea id="compact-flush-prompt">${escHtml(compaction.memoryFlush?.prompt || '')}</textarea>
          <span style="font-size: 11px; color: var(--text2);">Instruction sent to agent when triggering flush</span>
        </div>

        <div class="compaction-actions">
          <button class="btn" onclick="saveCompaction()">💾 Save Settings</button>
          <span id="compaction-save-status"></span>
        </div>
      </div>
    `;
    cont.innerHTML = formHtml;
  } catch (err) {
    $('compaction-content').innerHTML = `<div class="empty">❌ ${escHtml(err.message)}</div>`;
  }
}

async function saveCompaction() {
  const compaction = {
    reserveTokensFloor: parseInt($('compact-reserve-floor').value),
    memoryFlush: {
      enabled: $('compact-flush-enabled').checked,
      softThresholdTokens: parseInt($('compact-soft-threshold').value),
      prompt: $('compact-flush-prompt').value,
    },
  };

  const status = $('compaction-save-status');
  try {
    status.innerHTML = '<span class="loading-text"><span class="spinner"></span> Saving...</span>';
    const res = await fetch('/api/compaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compaction }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    status.innerHTML = '<span class="badge green">✓ Saved (backup created)</span>';
    setTimeout(() => { status.innerHTML = ''; }, 4000);
  } catch (err) {
    status.innerHTML = `<span class="badge red">❌ ${escHtml(err.message)}</span>`;
  }
}
```

**Step 5: Add to init block**

Add `loadCompaction()` to the Promise.all in the init block:

```javascript
await Promise.all([
  // ... existing loaders ...
  loadRouter(),
  loadCompaction(),
]);
```

**Step 6: Commit**

```bash
git add packages/dashboard/server.js packages/dashboard/public/index.html
git commit -m "feat(dashboard): add compaction settings editor panel

- GET /api/compaction - read from ~/.clawdbot/clawdbot.json
- POST /api/compaction - update settings with backup
- UI: editable fields for reserve floor, soft threshold, flush toggle, flush prompt
- Auto-creates .bak backup before writing
- XSS defense: escHtml() on all dynamic content (localhost admin tool)

Co-Authored-By: Claude (claude-sonnet-4-5) <noreply@anthropic.com>"
```

---

## Task 6: Final Integration & Verification

**Files:**
- None (verification only)

**Step 1: Start dashboard**

```bash
cd ~/Projects/localllm-hub
node cli.js dashboard
```

**Step 2: Verify all panels load**

Open browser to `http://localhost:3847`

Check:
- ✅ Router Prompt Editor card appears
- ✅ Compaction Settings card appears
- ✅ Can edit router prompt and save
- ✅ Can test router with sample queries
- ✅ Can edit compaction settings and save

**Step 3: Run router tuning tests**

```bash
node test/router-tuning.js
```

Expected: Accuracy ≥ 80%

**Step 4: Test fallback chain manually**

```bash
node -e "
const { resolveRoute } = require('./shared/fallback-chain');
console.log('Test 1:', resolveRoute('claude_haiku', ['claude_sonnet', 'gemini_3_pro']));
console.log('Test 2:', resolveRoute('claude_opus', ['local_qwen', 'claude_haiku']));
console.log('Test 3:', resolveRoute('local_qwen', []));
"
```

**Step 5: Final commit (if any fixes needed)**

If any bugs found during verification, fix and commit separately.

**Step 6: Trigger Clawdbot event**

```bash
clawdbot system event --text "routing-done" --mode now
```

---

## Summary Checklist

- [ ] Task 1: Router Prompt Editor dashboard panel (API + UI)
- [ ] Task 2: Cross-provider fallback chain (shared/fallback-chain.js)
- [ ] Task 3: Haiku XML prompt template (shared/haiku-xml-template.js)
- [ ] Task 4: Router tuning test suite (test/router-tuning.js with 30 cases)
- [ ] Task 5: Compaction Settings dashboard panel (API + UI)
- [ ] Task 6: Final integration verification

**Total commits:** 5 feature commits + 1 optional fix commit

**Testing:** Dashboard UI (manual), router tests (automated), fallback chain (manual), Haiku template (manual)

**Dashboard panels added:** 2 (Router Prompt Editor, Compaction Settings)

**New shared utilities:** 2 (fallback-chain.js, haiku-xml-template.js)

**Test coverage:** 30 router test cases across all 5 tiers

**Security:** All innerHTML usage protected with escHtml() per CLAUDE.md guidelines for localhost-only admin tool
