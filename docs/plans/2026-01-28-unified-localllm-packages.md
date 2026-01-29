# Unified LocalLLM Packages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build complete local LLM infrastructure with 6 packages (embeddings, classifier, triage, search, transcriber) sharing unified Ollama client.

**Architecture:** Node.js workspace using npm workspaces, all packages share Ollama client wrapper from `shared/`, rule-based classification with LLM fallback, SQLite vector search upgraded from nomic-embed-text to mxbai-embed-large.

**Tech Stack:** Node.js, Ollama npm client, better-sqlite3, commander CLI, whisper.cpp via safe execFile wrapper.

---

## Task 1: Initialize Workspace Root

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Step 1: Write package.json for npm workspaces**

```json
{
  "name": "localllm-hub",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "echo 'Run tests in individual packages'",
    "verify": "node -e \"require('./packages/embeddings'); require('./packages/classifier'); require('./packages/triage'); require('./packages/search'); require('./packages/transcriber'); console.log('✅ All packages load successfully')\""
  },
  "devDependencies": {
    "ollama": "^0.5.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0"
  }
}
```

**Step 2: Write .gitignore**

```
node_modules/
*.db
*.log
.DS_Store
*.swp
*.swo
*~
```

**Step 3: Create directories**

Run:
```bash
mkdir -p packages/embeddings packages/classifier packages/triage packages/search packages/transcriber shared
```

Expected: Directories created

**Step 4: Commit workspace setup**

```bash
git add package.json .gitignore
git commit -m "feat: initialize npm workspace root"
```

---

## Task 2: Shared Utilities

**Files:**
- Create: `shared/ollama.js`
- Create: `shared/config.js`
- Create: `shared/logger.js`

**Step 1: Write shared/ollama.js**

```javascript
const { Ollama } = require('ollama');

const client = new Ollama({
  host: process.env.OLLAMA_URL || 'http://localhost:11434'
});

/**
 * Generate text completion
 * @param {string} model - Model name (e.g., 'qwen2.5:7b')
 * @param {string} prompt - Prompt text
 * @param {object} opts - Additional options
 */
async function generate(model, prompt, opts = {}) {
  return client.generate({ model, prompt, stream: false, ...opts });
}

/**
 * Generate embeddings
 * @param {string} model - Embedding model (e.g., 'mxbai-embed-large')
 * @param {string|string[]} input - Text or array of texts
 */
async function embed(model, input) {
  return client.embed({ model, input });
}

/**
 * Chat completion
 * @param {string} model - Model name
 * @param {Array} messages - Chat messages [{role, content}]
 * @param {object} opts - Additional options
 */
async function chat(model, messages, opts = {}) {
  return client.chat({ model, messages, stream: false, ...opts });
}

module.exports = { generate, embed, chat };
```

**Step 2: Write shared/config.js**

```javascript
const { homedir } = require('os');
const { join } = require('path');

module.exports = {
  models: {
    triage: 'qwen2.5:7b',
    code: 'qwen2.5-coder:32b',
    reasoning: 'deepseek-r1:32b',
    embed: 'mxbai-embed-large',      // 1024-dim
    embedFast: 'nomic-embed-text',   // 768-dim
  },
  thresholds: {
    confidence: 0.8,
    urgency: 3,
  },
  paths: {
    memoryDir: join(homedir(), 'clawd/memory'),
    emailDb: join(homedir(), 'Projects/emailctl/emails.db'),
    searchDb: join(homedir(), 'clawd/scripts/memory.db'),
  },
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    timeout: 30000,
  },
  embedding: {
    dimension: 1024, // mxbai-embed-large
    chunkSize: 500,
    chunkOverlap: 100,
  }
};
```

**Step 3: Write shared/logger.js**

```javascript
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function log(level, ...args) {
  if (LOG_LEVELS[level] >= currentLevel) {
    const prefix = {
      debug: '🔍',
      info: 'ℹ️ ',
      warn: '⚠️ ',
      error: '❌',
    }[level];
    console.log(prefix, ...args);
  }
}

module.exports = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
};
```

**Step 4: Commit shared utilities**

```bash
git add shared/
git commit -m "feat: add shared Ollama client and utilities"
```

---

## Task 3: Embeddings Package

**Files:**
- Create: `packages/embeddings/package.json`
- Create: `packages/embeddings/index.js`
- Create: `packages/embeddings/cli.js`

**Step 1: Write packages/embeddings/package.json**

```json
{
  "name": "@localllm/embeddings",
  "version": "1.0.0",
  "main": "index.js",
  "bin": {
    "localllm-embed": "./cli.js"
  },
  "dependencies": {
    "ollama": "^0.5.0",
    "commander": "^12.0.0"
  }
}
```

**Step 2: Write packages/embeddings/index.js**

```javascript
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

/**
 * Generate embedding for single text
 * @param {string} text - Input text
 * @param {string} model - Embedding model (default: mxbai-embed-large)
 * @returns {Promise<number[]>} Embedding vector
 */
async function generateEmbed(text, model = config.models.embed) {
  logger.debug(`Generating embedding for text: ${text.slice(0, 50)}...`);
  const response = await embed(model, text);
  return response.embeddings[0];
}

/**
 * Generate embeddings for multiple texts
 * @param {string[]} texts - Array of input texts
 * @param {string} model - Embedding model
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
async function batchEmbed(texts, model = config.models.embed) {
  logger.debug(`Generating ${texts.length} embeddings`);
  const response = await embed(model, texts);
  return response.embeddings;
}

/**
 * Compute cosine similarity between two embeddings
 * @param {number[]} a - First embedding
 * @param {number[]} b - Second embedding
 * @returns {number} Similarity score (0-1)
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compare two texts by embedding similarity
 * @param {string} textA - First text
 * @param {string} textB - Second text
 * @param {string} model - Embedding model
 * @returns {Promise<number>} Similarity score
 */
async function compare(textA, textB, model = config.models.embed) {
  const embeddings = await batchEmbed([textA, textB], model);
  return cosineSimilarity(embeddings[0], embeddings[1]);
}

module.exports = {
  embed: generateEmbed,
  batchEmbed,
  compare,
  cosineSimilarity,
};
```

**Step 3: Write packages/embeddings/cli.js**

```javascript
#!/usr/bin/env node
const { Command } = require('commander');
const { embed, batchEmbed, compare } = require('./index');

const program = new Command();

program
  .name('localllm-embed')
  .description('Generate embeddings using Ollama')
  .version('1.0.0');

program
  .command('embed <text>')
  .description('Generate embedding for text')
  .option('-m, --model <model>', 'Embedding model', 'mxbai-embed-large')
  .action(async (text, options) => {
    try {
      const embedding = await embed(text, options.model);
      console.log(JSON.stringify(embedding));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('batch-embed <texts...>')
  .description('Generate embeddings for multiple texts')
  .option('-m, --model <model>', 'Embedding model', 'mxbai-embed-large')
  .action(async (texts, options) => {
    try {
      const embeddings = await batchEmbed(texts, options.model);
      console.log(JSON.stringify(embeddings));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('compare <textA> <textB>')
  .description('Compare similarity between two texts')
  .option('-m, --model <model>', 'Embedding model', 'mxbai-embed-large')
  .action(async (textA, textB, options) => {
    try {
      const similarity = await compare(textA, textB, options.model);
      console.log(`Similarity: ${similarity.toFixed(4)}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
```

**Step 4: Make CLI executable**

Run: `chmod +x packages/embeddings/cli.js`

Expected: File is executable

**Step 5: Commit embeddings package**

```bash
git add packages/embeddings/
git commit -m "feat: add embeddings package with CLI"
```

---

## Task 4: Classifier Package

**Files:**
- Create: `packages/classifier/package.json`
- Create: `packages/classifier/rules.js`
- Create: `packages/classifier/llm.js`
- Create: `packages/classifier/index.js`
- Create: `packages/classifier/cli.js`

**Step 1: Write packages/classifier/package.json**

```json
{
  "name": "@localllm/classifier",
  "version": "1.0.0",
  "main": "index.js",
  "bin": {
    "localllm-classify": "./cli.js"
  },
  "dependencies": {
    "ollama": "^0.5.0",
    "commander": "^12.0.0"
  }
}
```

**Step 2: Write packages/classifier/rules.js**

```javascript
/**
 * Rule-based email classifier
 * Ported from ~/Projects/emailctl/lib/classifier.js
 */

const rules = {
  junk: [
    { type: 'fromDomain', patterns: ['marketing.', 'promo.', 'notifications@'] },
    { type: 'subject', regex: /\b(unsubscribe|opt.out)\b/i },
    { type: 'label', value: 'SPAM' }
  ],

  subscriptions: [
    { type: 'fromDomain', patterns: ['newsletter', 'updates@', 'noreply@'] },
    { type: 'subject', regex: /newsletter|digest|weekly|monthly/i },
    { type: 'body', keywords: ['unsubscribe', 'manage preferences'] }
  ],

  bills: [
    { type: 'subject', regex: /invoice|receipt|payment|bill|statement/i },
    { type: 'fromDomain', patterns: ['billing@', 'invoices@', 'payments@'] },
    { type: 'body', keywords: ['amount due', 'payment received'] }
  ],

  jobs: [
    { type: 'subject', regex: /job|career|position|interview|application/i },
    { type: 'fromDomain', patterns: ['jobs@', 'careers@', 'linkedin.com', 'indeed.com'] }
  ],

  shopping: [
    { type: 'subject', regex: /order|shipping|delivery|tracking|cart/i },
    { type: 'fromDomain', patterns: ['amazon.', 'ebay.', 'shopify.', 'shop@'] },
    { type: 'label', value: 'CATEGORY_PROMOTIONS' }
  ],

  travel: [
    { type: 'subject', regex: /flight|booking|reservation|hotel|trip/i },
    { type: 'fromDomain', patterns: ['airbnb.', 'booking.', 'expedia.', 'airline'] }
  ],

  finance: [
    { type: 'subject', regex: /account|transaction|balance|credit|debit/i },
    { type: 'fromDomain', patterns: ['bank', 'paypal.', 'venmo.', 'stripe.'] }
  ],

  health: [
    { type: 'subject', regex: /appointment|prescription|medical|health|doctor/i },
    { type: 'fromDomain', patterns: ['health', 'medical', 'pharmacy'] }
  ],

  newsletters: [
    { type: 'label', value: 'CATEGORY_UPDATES' },
    { type: 'subject', regex: /edition|issue #|this week|today in/i }
  ],

  notifications: [
    { type: 'subject', regex: /alert|notification|reminder|confirm/i },
    { type: 'fromDomain', patterns: ['notifications@', 'alerts@', 'no-reply@'] }
  ],

  personal: [
    { type: 'label', value: 'CATEGORY_PERSONAL' }
  ],

  legal: [
    { type: 'subject', regex: /terms|privacy|policy|legal|agreement/i },
    { type: 'fromDomain', patterns: ['legal@', 'compliance@'] }
  ]
};

const categoryOrder = [
  'junk', 'bills', 'jobs', 'finance', 'health', 'legal',
  'travel', 'shopping', 'subscriptions', 'newsletters',
  'notifications', 'personal'
];

function matchesRule(email, rule) {
  switch (rule.type) {
    case 'fromDomain':
      return rule.patterns.some(pattern =>
        email.from.toLowerCase().includes(pattern.toLowerCase())
      );

    case 'subject':
      return rule.regex.test(email.subject);

    case 'body':
      if (!email.body) return false;
      return rule.keywords.some(keyword =>
        email.body.toLowerCase().includes(keyword.toLowerCase())
      );

    case 'label':
      return email.labels && email.labels.includes(rule.value);

    default:
      return false;
  }
}

function matchesCategory(email, category) {
  const categoryRules = rules[category];
  if (!categoryRules) return false;

  for (const rule of categoryRules) {
    if (matchesRule(email, rule)) {
      return true;
    }
  }
  return false;
}

function classify(email) {
  for (const category of categoryOrder) {
    if (matchesCategory(email, category)) {
      return category;
    }
  }
  return null; // No rule matched, needs LLM fallback
}

module.exports = { classify, rules, categoryOrder };
```

**Step 3: Write packages/classifier/llm.js**

```javascript
const { chat } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

const VALID_CATEGORIES = [
  'junk', 'subscriptions', 'bills', 'jobs', 'shopping',
  'travel', 'finance', 'health', 'newsletters',
  'notifications', 'personal', 'legal'
];

/**
 * Classify email using LLM fallback
 * @param {object} email - Email object {from, subject, body}
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<{category: string, confidence: number}>}
 */
async function classifyWithLLM(email, timeout = 5000) {
  try {
    const bodyPreview = email.body
      ? email.body.substring(0, 300)
      : '';

    const prompt = `Classify this email into ONE of these categories: ${VALID_CATEGORIES.join(', ')}.

From: ${email.from}
Subject: ${email.subject}
Body: ${bodyPreview}

Return ONLY the category name, nothing else.`;

    logger.debug('Classifying with LLM:', email.subject);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), timeout);
    });

    const chatPromise = chat(config.models.triage, [
      { role: 'user', content: prompt }
    ]);

    const response = await Promise.race([chatPromise, timeoutPromise]);
    const category = response.message.content.trim().toLowerCase();

    // Validate category
    if (!VALID_CATEGORIES.includes(category)) {
      logger.warn(`LLM returned invalid category: ${category}`);
      return { category: 'uncategorized', confidence: 0 };
    }

    // Estimate confidence (simple heuristic)
    const confidence = 0.7; // LLM fallback has lower confidence

    return { category, confidence };
  } catch (error) {
    logger.error('LLM classification failed:', error.message);
    return { category: 'uncategorized', confidence: 0 };
  }
}

module.exports = { classifyWithLLM, VALID_CATEGORIES };
```

**Step 4: Write packages/classifier/index.js**

```javascript
const { classify: classifyRules } = require('./rules');
const { classifyWithLLM } = require('./llm');
const logger = require('../../shared/logger');

/**
 * Classify email using rules first, LLM fallback second
 * @param {object} email - Email object {from, subject, body?, labels?}
 * @returns {Promise<{category: string, confidence: number, method: string}>}
 */
async function classify(email) {
  // Try rules first
  const ruleCategory = classifyRules(email);

  if (ruleCategory) {
    logger.debug(`Classified by rule: ${ruleCategory}`);
    return {
      category: ruleCategory,
      confidence: 1.0,
      method: 'rules'
    };
  }

  // Fallback to LLM
  logger.debug('No rule matched, using LLM fallback');
  const llmResult = await classifyWithLLM(email);

  return {
    category: llmResult.category,
    confidence: llmResult.confidence,
    method: 'llm'
  };
}

module.exports = { classify };
```

**Step 5: Write packages/classifier/cli.js**

```javascript
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
```

**Step 6: Make CLI executable**

Run: `chmod +x packages/classifier/cli.js`

Expected: File is executable

**Step 7: Commit classifier package**

```bash
git add packages/classifier/
git commit -m "feat: add classifier package with rules and LLM fallback"
```

---

## Task 5: Triage Package

**Files:**
- Create: `packages/triage/package.json`
- Create: `packages/triage/index.js`
- Create: `packages/triage/cli.js`

**Step 1: Write packages/triage/package.json**

```json
{
  "name": "@localllm/triage",
  "version": "1.0.0",
  "main": "index.js",
  "bin": {
    "localllm-triage": "./cli.js"
  },
  "dependencies": {
    "ollama": "^0.5.0",
    "commander": "^12.0.0"
  }
}
```

**Step 2: Write packages/triage/index.js**

```javascript
const { chat } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

/**
 * Rate urgency of a task/message
 * @param {string} text - Input text
 * @returns {Promise<{urgency: number, reasoning: string}>}
 */
async function rateUrgency(text) {
  const prompt = `Rate the urgency of this message on a scale of 1-5:
1 = Not urgent, can wait days
2 = Low urgency, can wait 24 hours
3 = Medium urgency, should handle today
4 = High urgency, handle within hours
5 = Critical urgency, immediate action required

Message: ${text}

Return a JSON object with "urgency" (1-5) and "reasoning" (brief explanation).`;

  try {
    const response = await chat(config.models.triage, [
      { role: 'user', content: prompt }
    ]);

    const content = response.message.content.trim();

    // Try to parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        urgency: Math.min(5, Math.max(1, result.urgency || 3)),
        reasoning: result.reasoning || 'No reasoning provided'
      };
    }

    // Fallback: extract number
    const numberMatch = content.match(/\b([1-5])\b/);
    const urgency = numberMatch ? parseInt(numberMatch[1]) : 3;

    return {
      urgency,
      reasoning: content
    };
  } catch (error) {
    logger.error('Urgency rating failed:', error.message);
    return { urgency: 3, reasoning: 'Error during classification' };
  }
}

/**
 * Route task to local or API based on complexity
 * @param {string} text - Task description
 * @returns {Promise<{route: string, confidence: number, reasoning: string}>}
 */
async function routeTask(text) {
  const prompt = `Determine if this task should be handled locally (fast, simple) or escalated to API (complex, requires research):

Task: ${text}

Return JSON with:
- "route": "local" or "api"
- "confidence": 0.0-1.0
- "reasoning": brief explanation

Local tasks: simple queries, straightforward operations, quick lookups
API tasks: complex analysis, research required, multi-step reasoning`;

  try {
    const response = await chat(config.models.triage, [
      { role: 'user', content: prompt }
    ]);

    const content = response.message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        route: result.route === 'api' ? 'api' : 'local',
        confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
        reasoning: result.reasoning || 'No reasoning provided'
      };
    }

    // Fallback
    return {
      route: 'local',
      confidence: 0.5,
      reasoning: content
    };
  } catch (error) {
    logger.error('Task routing failed:', error.message);
    return {
      route: 'local',
      confidence: 0.5,
      reasoning: 'Error during routing'
    };
  }
}

module.exports = { rateUrgency, routeTask };
```

**Step 3: Write packages/triage/cli.js**

```javascript
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
```

**Step 4: Make CLI executable**

Run: `chmod +x packages/triage/cli.js`

Expected: File is executable

**Step 5: Commit triage package**

```bash
git add packages/triage/
git commit -m "feat: add triage package for urgency rating and routing"
```

---

## Task 6: Search Package

**Files:**
- Create: `packages/search/package.json`
- Create: `packages/search/indexer.js`
- Create: `packages/search/index.js`
- Create: `packages/search/cli.js`

**Step 1: Write packages/search/package.json**

```json
{
  "name": "@localllm/search",
  "version": "1.0.0",
  "main": "index.js",
  "bin": {
    "localllm-search": "./cli.js"
  },
  "dependencies": {
    "ollama": "^0.5.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0"
  }
}
```

**Step 2: Write packages/search/indexer.js**

```javascript
const Database = require('better-sqlite3');
const { readFileSync, readdirSync, statSync } = require('fs');
const { join, relative } = require('path');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

/**
 * Convert float array to buffer for SQLite
 */
function embeddingToBuffer(embedding) {
  const buffer = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  return buffer;
}

/**
 * Convert buffer back to float array
 */
function bufferToEmbedding(buffer) {
  const embedding = [];
  for (let i = 0; i < buffer.length; i += 4) {
    embedding.push(buffer.readFloatLE(i));
  }
  return embedding;
}

/**
 * Chunk text intelligently by headers and size
 */
function chunkText(text, filePath) {
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let chunkStartLine = 1;
  let currentLine = 1;

  for (const line of lines) {
    const isHeader = line.startsWith('#');
    const wouldExceed = (currentChunk + '\n' + line).length > config.embedding.chunkSize;

    if ((isHeader || wouldExceed) && currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        file: filePath,
        startLine: chunkStartLine,
        endLine: currentLine - 1
      });

      const overlapStart = Math.max(0, currentChunk.length - config.embedding.chunkOverlap);
      currentChunk = currentChunk.slice(overlapStart) + '\n' + line;
      chunkStartLine = Math.max(1, currentLine - 2);
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
    currentLine++;
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      file: filePath,
      startLine: chunkStartLine,
      endLine: currentLine - 1
    });
  }

  return chunks;
}

/**
 * Find all markdown files recursively
 */
function findMarkdownFiles(dir) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Initialize database schema
 */
function initDb(dbPath) {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);
  `);

  return db;
}

/**
 * Index directory of markdown files
 */
async function indexDirectory(sourceDir, dbPath) {
  logger.info('Indexing memory files to SQLite...');
  const db = initDb(dbPath);

  // Clear existing data
  db.exec('DELETE FROM chunks');

  const files = findMarkdownFiles(sourceDir);
  logger.info(`Found ${files.length} markdown files`);

  const allChunks = [];

  for (const file of files) {
    const relPath = relative(sourceDir, file);
    logger.debug(`Processing: ${relPath}`);
    const content = readFileSync(file, 'utf-8');
    const chunks = chunkText(content, relPath);
    allChunks.push(...chunks);
  }

  logger.info(`Created ${allChunks.length} chunks, generating embeddings...`);

  const insert = db.prepare(`
    INSERT INTO chunks (file, start_line, end_line, text, embedding)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((chunks) => {
    for (const chunk of chunks) {
      insert.run(chunk.file, chunk.startLine, chunk.endLine, chunk.text, chunk.embedding);
    }
  });

  // Generate embeddings in batches
  const BATCH_SIZE = 10;
  const chunksWithEmbeddings = [];

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, Math.min(i + BATCH_SIZE, allChunks.length));
    process.stdout.write(`\r  Embedding ${i + 1}-${i + batch.length}/${allChunks.length}`);

    try {
      const texts = batch.map(c => c.text);
      const response = await embed(config.models.embed, texts);

      for (let j = 0; j < batch.length; j++) {
        chunksWithEmbeddings.push({
          ...batch[j],
          embedding: embeddingToBuffer(response.embeddings[j])
        });
      }
    } catch (err) {
      logger.error(`Error embedding batch: ${err.message}`);
    }
  }

  console.log('\n');
  logger.info('Saving to SQLite...');
  insertMany(chunksWithEmbeddings);

  const count = db.prepare('SELECT COUNT(*) as count FROM chunks').get();
  logger.info(`Saved ${count.count} chunks to ${dbPath}`);

  db.close();
}

module.exports = {
  indexDirectory,
  initDb,
  embeddingToBuffer,
  bufferToEmbedding,
  chunkText,
  findMarkdownFiles,
};
```

**Step 3: Write packages/search/index.js**

```javascript
const Database = require('better-sqlite3');
const { existsSync } = require('fs');
const { embed } = require('../../shared/ollama');
const config = require('../../shared/config');
const logger = require('../../shared/logger');
const { initDb, embeddingToBuffer, bufferToEmbedding } = require('./indexer');

/**
 * Cosine similarity between two embeddings
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search indexed content
 * @param {string} query - Search query
 * @param {string} dbPath - Path to SQLite database
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array>} Ranked search results
 */
async function search(query, dbPath, topK = 5) {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run reindex first.`);
  }

  const db = initDb(dbPath);
  logger.debug(`Searching for: "${query}"`);

  const queryEmbedding = await embed(config.models.embed, query);
  const queryVector = queryEmbedding.embeddings[0];

  // Get all chunks and compute similarity
  const chunks = db.prepare('SELECT * FROM chunks').all();

  const results = chunks
    .map(chunk => ({
      ...chunk,
      embedding: bufferToEmbedding(chunk.embedding),
    }))
    .map(chunk => ({
      file: chunk.file,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      text: chunk.text,
      score: cosineSimilarity(queryVector, chunk.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  db.close();
  return results;
}

module.exports = { search };
```

**Step 4: Write packages/search/cli.js**

```javascript
#!/usr/bin/env node
const { Command } = require('commander');
const { search } = require('./index');
const { indexDirectory } = require('./indexer');
const config = require('../../shared/config');
const { homedir } = require('os');
const { join } = require('path');

const program = new Command();
const DEFAULT_DB = join(homedir(), 'clawd/scripts/memory.db');
const DEFAULT_SOURCE = config.paths.memoryDir;

program
  .name('localllm-search')
  .description('Semantic search over indexed content')
  .version('1.0.0');

program
  .command('search <query>')
  .description('Search for content')
  .option('-d, --db <path>', 'Database path', DEFAULT_DB)
  .option('-k, --top-k <number>', 'Number of results', '5')
  .action(async (query, options) => {
    try {
      const results = await search(query, options.db, parseInt(options.topK));

      console.log('\n📄 Results:\n');
      for (const result of results) {
        console.log(`[${result.score.toFixed(3)}] ${result.file}:${result.startLine}-${result.endLine}`);
        console.log(`  ${result.text.slice(0, 200).replace(/\n/g, ' ')}...`);
        console.log();
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('reindex')
  .description('Rebuild search index')
  .option('-s, --source <path>', 'Source directory', DEFAULT_SOURCE)
  .option('-d, --db <path>', 'Database path', DEFAULT_DB)
  .action(async (options) => {
    try {
      await indexDirectory(options.source, options.db);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
```

**Step 5: Make CLI executable**

Run: `chmod +x packages/search/cli.js`

Expected: File is executable

**Step 6: Commit search package**

```bash
git add packages/search/
git commit -m "feat: add search package with SQLite vector search"
```

---

## Task 7: Transcriber Package

**Files:**
- Create: `packages/transcriber/package.json`
- Create: `packages/transcriber/index.js`
- Create: `packages/transcriber/cli.js`

**Step 1: Write packages/transcriber/package.json**

```json
{
  "name": "@localllm/transcriber",
  "version": "1.0.0",
  "main": "index.js",
  "bin": {
    "localllm-transcribe": "./cli.js"
  },
  "dependencies": {
    "commander": "^12.0.0"
  }
}
```

**Step 2: Write packages/transcriber/index.js (SECURE VERSION)**

```javascript
const { execFile } = require('child_process');
const { promisify } = require('util');
const { existsSync, readdirSync, statSync } = require('fs');
const { join, extname } = require('path');
const logger = require('../../shared/logger');

// SECURITY: Using execFile (not exec) to prevent shell injection
const execFileAsync = promisify(execFile);

const SUPPORTED_FORMATS = ['.m4a', '.wav', '.mp3', '.mp4', '.ogg', '.flac'];

/**
 * Find whisper.cpp binary
 */
function findWhisperBinary() {
  const candidates = [
    '/usr/local/bin/whisper-cpp',
    '/opt/homebrew/bin/whisper-cpp',
    '/usr/bin/whisper-cpp',
    process.env.WHISPER_CPP_PATH,
  ].filter(Boolean);

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error('whisper.cpp binary not found. Install whisper.cpp or set WHISPER_CPP_PATH');
}

/**
 * Transcribe audio file
 * @param {string} filePath - Path to audio file
 * @param {object} options - Transcription options
 * @returns {Promise<{text: string, duration: number}>}
 */
async function transcribe(filePath, options = {}) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  const whisperBinary = options.whisperBinary || findWhisperBinary();
  const model = options.model || 'base';
  const language = options.language || 'auto';

  logger.info(`Transcribing: ${filePath}`);

  // SECURITY: Using array of args (not string interpolation) prevents injection
  const args = [
    '-m', model,
    '-f', filePath,
  ];

  if (language !== 'auto') {
    args.push('-l', language);
  }

  if (options.threads) {
    args.push('-t', options.threads.toString());
  }

  try {
    const startTime = Date.now();
    const { stdout } = await execFileAsync(whisperBinary, args);
    const duration = Date.now() - startTime;

    // Parse whisper output (format varies, basic extraction)
    const text = stdout
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('['))
      .join(' ')
      .trim();

    return { text, duration };
  } catch (error) {
    logger.error(`Transcription failed: ${error.message}`);
    throw error;
  }
}

/**
 * Transcribe all audio files in directory
 * @param {string} dirPath - Directory path
 * @param {object} options - Transcription options
 * @returns {Promise<Array>} Array of {file, text, duration}
 */
async function batchTranscribe(dirPath, options = {}) {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const files = readdirSync(dirPath)
    .filter(f => SUPPORTED_FORMATS.includes(extname(f).toLowerCase()))
    .map(f => join(dirPath, f));

  logger.info(`Found ${files.length} audio files`);

  const results = [];
  for (const file of files) {
    try {
      const result = await transcribe(file, options);
      results.push({ file, ...result });
    } catch (error) {
      logger.error(`Failed to transcribe ${file}: ${error.message}`);
      results.push({ file, text: null, error: error.message });
    }
  }

  return results;
}

module.exports = {
  transcribe,
  batchTranscribe,
  findWhisperBinary,
  SUPPORTED_FORMATS,
};
```

**Step 3: Write packages/transcriber/cli.js**

```javascript
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
```

**Step 4: Make CLI executable**

Run: `chmod +x packages/transcriber/cli.js`

Expected: File is executable

**Step 5: Commit transcriber package**

```bash
git add packages/transcriber/
git commit -m "feat: add transcriber package with secure whisper.cpp wrapper"
```

---

## Task 8: Install Dependencies and Verify

**Files:**
- Modify: Root `package.json` (if needed)

**Step 1: Install all dependencies**

Run: `npm install`

Expected: Dependencies installed successfully

**Step 2: Verify embeddings package loads**

Run: `node -e "require('./packages/embeddings'); console.log('✅ embeddings')"`

Expected: ✅ embeddings

**Step 3: Verify classifier package loads**

Run: `node -e "require('./packages/classifier'); console.log('✅ classifier')"`

Expected: ✅ classifier

**Step 4: Verify triage package loads**

Run: `node -e "require('./packages/triage'); console.log('✅ triage')"`

Expected: ✅ triage

**Step 5: Verify search package loads**

Run: `node -e "require('./packages/search'); console.log('✅ search')"`

Expected: ✅ search

**Step 6: Verify transcriber package loads**

Run: `node -e "require('./packages/transcriber'); console.log('✅ transcriber')"`

Expected: ✅ transcriber

**Step 7: Run workspace verification script**

Run: `npm run verify`

Expected: ✅ All packages load successfully

**Step 8: Commit verification**

```bash
git add package-lock.json
git commit -m "chore: install dependencies and verify all packages"
```

---

## Task 9: Final Verification and Notification

**Files:**
- None

**Step 1: Test embeddings CLI help**

Run: `node packages/embeddings/cli.js --help`

Expected: CLI help output

**Step 2: Test classifier CLI help**

Run: `node packages/classifier/cli.js --help`

Expected: CLI help output

**Step 3: Create final commit**

```bash
git add .
git commit -m "feat: complete localllm-hub unified packages build" -m "- embeddings: mxbai-embed-large wrapper with CLI
- classifier: rules + LLM fallback (ported from emailctl)
- triage: urgency rating and task routing
- search: SQLite vector search (upgraded from nomic to mxbai)
- transcriber: secure whisper.cpp wrapper (uses execFile)
- shared: Ollama client, config, logger"
```

**Step 4: Notify completion**

Run: `clawdbot gateway wake --text "Done: all localllm-hub packages built" --mode now`

Expected: Notification sent

**Step 5: Display summary**

Run:
```bash
echo "✅ LocalLLM Hub Build Complete

Packages created:
- packages/embeddings/     (embed, batch-embed, compare)
- packages/classifier/     (rules + LLM classification)
- packages/triage/         (urgency rating, task routing)
- packages/search/         (SQLite vector search)
- packages/transcriber/    (secure whisper.cpp wrapper)

Shared utilities:
- shared/ollama.js         (unified Ollama client)
- shared/config.js         (models, paths, thresholds)
- shared/logger.js         (leveled logging)

Next steps:
- Start Ollama: ollama serve
- Pull models: ollama pull mxbai-embed-large qwen2.5:7b
- Test CLIs: node packages/<package>/cli.js --help"
```

Expected: Summary displayed

---

## Completion Checklist

- [ ] All 6 packages created with package.json
- [ ] All CLIs are executable (chmod +x)
- [ ] Shared utilities in place (ollama.js, config.js, logger.js)
- [ ] npm install successful
- [ ] All packages load without error
- [ ] Classifier rules ported from emailctl
- [ ] Search indexer upgraded to mxbai-embed-large (1024-dim)
- [ ] Transcriber uses secure execFile (not exec)
- [ ] All code committed to git
- [ ] Clawdbot notification sent

---

## Notes

**Embedding Model Upgrade:**
Original semantic-search used `nomic-embed-text` (768-dim). This implementation uses `mxbai-embed-large` (1024-dim) for better quality.

**Classification Strategy:**
Rules-first approach (O(1) for most emails), LLM fallback only for edge cases. Same pattern as emailctl.

**Whisper Integration (SECURE):**
Uses `execFile` with array args (not `exec` with string interpolation) to prevent shell injection. Assumes binary is installed at standard paths or via WHISPER_CPP_PATH env var.

**Testing Without Ollama:**
Package loading verification (`require()`) will work even if Ollama is not running. Actual API calls will fail with connection errors until `ollama serve` is running.
