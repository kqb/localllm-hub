# Context & Memory Optimization Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a librarian agent for pre-fetching context, implement always-warm router, add embedding cache, and create embedding explorer dashboard panel.

**Architecture:** Four independent optimization layers: (1) Librarian package aggregates semantic search from memory + chat + telegram sources, (2) Shell script + launchd daemon keeps router model warm, (3) Content-hash-based caching skips redundant embeddings during reindex, (4) Dashboard panel visualizes embedding space with 2D projection.

**Tech Stack:** Node.js, better-sqlite3, Commander.js, Express, vanilla JS, Ollama, launchd, crypto (for SHA-256). Uses `execFile` for shell commands (not `exec`) to prevent injection.

---

## Task 1: Librarian Package - Package Structure

**Files:**
- Create: `packages/librarian/package.json`
- Create: `packages/librarian/index.js` (stub)
- Create: `packages/librarian/cli.js` (stub)

**Step 1: Create package.json**

Create `packages/librarian/package.json`:

```json
{
  "name": "@localllm/librarian",
  "version": "1.0.0",
  "description": "Pre-fetch context from multiple sources for prompt injection",
  "main": "index.js",
  "bin": {
    "localllm-librarian": "./cli.js"
  },
  "dependencies": {
    "commander": "^12.0.0"
  }
}
```

**Step 2: Create index.js stub**

Create `packages/librarian/index.js`:

```javascript
// Librarian: Pre-fetch context from memory + chat + telegram
module.exports = {
  prefetchContext: async () => { throw new Error('Not implemented'); },
};
```

**Step 3: Create cli.js stub**

Create `packages/librarian/cli.js`:

```javascript
#!/usr/bin/env node
const { Command } = require('commander');

const program = new Command();

program
  .name('localllm-librarian')
  .description('Pre-fetch context for prompt injection')
  .version('1.0.0');

program
  .command('prefetch <query>')
  .description('Pre-fetch context blocks from all sources')
  .option('-k, --top-k <number>', 'Number of results per source', '5')
  .option('-s, --sources <list>', 'Comma-separated sources', 'memory,chat,telegram')
  .option('--include-grep', 'Include keyword grep results', false)
  .action(async (query, options) => {
    console.error('Not yet implemented');
    process.exit(1);
  });

program.parse();
```

**Step 4: Install dependencies**

Run: `cd /tmp/llm-context && npm install`

Expected: Workspace linked, no errors

**Step 5: Commit**

```bash
git add packages/librarian/
git commit -m "feat(librarian): add package structure"
```

---

## Task 2: Librarian Package - Core Implementation

**Files:**
- Modify: `packages/librarian/index.js`

**Step 1: Implement prefetchContext function**

Replace entire `packages/librarian/index.js`:

```javascript
const { search: memorySearch } = require('../search');
const { unifiedSearch } = require('../chat-ingest/unified-search');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../../shared/config');
const logger = require('../../shared/logger');

const execFileAsync = promisify(execFile);

/**
 * Pre-fetch context from multiple sources for prompt injection
 * @param {string} userQuery - The user's query
 * @param {object} [options]
 * @param {number} [options.topK=5] - Results per source
 * @param {string[]} [options.sources=['memory','chat','telegram']] - Sources to search
 * @param {boolean} [options.includeGrep=false] - Include grep results
 * @param {string} [options.grepPath] - Path to grep for keywords (if includeGrep=true)
 * @returns {Promise<{ blocks: Array<{ source: string, text: string, score: number, location: string }>, summary: object }>}
 */
async function prefetchContext(userQuery, options = {}) {
  const topK = options.topK || 5;
  const sources = options.sources || ['memory', 'chat', 'telegram'];
  const includeGrep = options.includeGrep || false;
  const grepPath = options.grepPath || config.paths.memoryDir;

  logger.debug(`Librarian: prefetching for query="${userQuery.slice(0, 50)}..."`);

  const blocks = [];
  const summary = { sources: {}, totalResults: 0, queryTime: Date.now() };

  // 1. Unified semantic search (memory + chat + telegram)
  try {
    const results = await unifiedSearch(userQuery, {
      topK: topK * sources.length, // Get more, then distribute
      sources,
    });

    // Group by source and take topK per source
    const bySource = {};
    for (const r of results) {
      if (!bySource[r.source]) bySource[r.source] = [];
      bySource[r.source].push(r);
    }

    for (const [src, items] of Object.entries(bySource)) {
      const topItems = items.slice(0, topK);
      summary.sources[src] = topItems.length;

      for (const item of topItems) {
        let location = '';
        if (src === 'memory') {
          location = `${item.meta.file}:${item.meta.startLine}-${item.meta.endLine}`;
        } else if (src === 'chat') {
          location = `session:${item.meta.sessionId?.slice(0, 8)} ${item.meta.startTs}`;
        } else if (src === 'telegram') {
          location = `telegram ${item.meta.startTs}`;
        }

        blocks.push({
          source: src,
          text: item.text,
          score: item.score,
          location,
        });
      }
    }
  } catch (err) {
    logger.error(`Semantic search failed: ${err.message}`);
    summary.semanticSearchError = err.message;
  }

  // 2. Optional: keyword grep (uses execFile for security)
  if (includeGrep) {
    try {
      const keywords = extractKeywords(userQuery);
      if (keywords.length > 0) {
        const pattern = keywords.join('|');
        // Use execFile with argument array (not exec) to prevent shell injection
        const { stdout } = await execFileAsync('grep', [
          '-rni',
          '--include=*.md',
          '-E',
          pattern,
          grepPath,
        ], { timeout: 5000, maxBuffer: 1024 * 1024 });

        const grepLines = stdout.split('\n').filter(Boolean).slice(0, topK);
        summary.sources.grep = grepLines.length;

        for (const line of grepLines) {
          const [location, ...textParts] = line.split(':');
          blocks.push({
            source: 'grep',
            text: textParts.join(':').trim(),
            score: 0, // grep doesn't provide semantic score
            location: location.trim(),
          });
        }
      }
    } catch (err) {
      // grep not found or no matches - not fatal
      logger.debug(`Grep failed: ${err.message}`);
      summary.grepError = err.message;
    }
  }

  summary.totalResults = blocks.length;
  summary.queryTime = Date.now() - summary.queryTime;

  logger.debug(`Librarian: fetched ${blocks.length} blocks in ${summary.queryTime}ms`);

  return { blocks, summary };
}

/**
 * Extract likely keywords from query for grep (simple heuristic)
 */
function extractKeywords(query) {
  const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'why', 'when', 'where', 'who']);
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .slice(0, 5); // max 5 keywords
}

/**
 * Format blocks as markdown for prompt injection
 */
function formatAsMarkdown(blocks) {
  let output = '# Pre-Fetched Context\n\n';
  for (const block of blocks) {
    output += `## [${block.source}] ${block.location}\n`;
    if (block.score > 0) {
      output += `**Relevance:** ${block.score.toFixed(3)}\n\n`;
    }
    output += `${block.text}\n\n---\n\n`;
  }
  return output;
}

module.exports = {
  prefetchContext,
  formatAsMarkdown,
};
```

**Step 2: Verify syntax**

Run: `node -c /tmp/llm-context/packages/librarian/index.js`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/librarian/index.js
git commit -m "feat(librarian): implement prefetchContext with multi-source search"
```

---

## Task 3: Librarian Package - CLI Implementation

**Files:**
- Modify: `packages/librarian/cli.js`

**Step 1: Implement CLI commands**

Replace entire `packages/librarian/cli.js`:

```javascript
#!/usr/bin/env node
const { Command } = require('commander');
const { prefetchContext, formatAsMarkdown } = require('./index');

const program = new Command();

program
  .name('localllm-librarian')
  .description('Pre-fetch context for prompt injection')
  .version('1.0.0');

program
  .command('prefetch <query>')
  .description('Pre-fetch context blocks from all sources')
  .option('-k, --top-k <number>', 'Number of results per source', '5')
  .option('-s, --sources <list>', 'Comma-separated sources', 'memory,chat,telegram')
  .option('--include-grep', 'Include keyword grep results', false)
  .option('--grep-path <path>', 'Path to grep (if include-grep)')
  .option('--format <type>', 'Output format: json|markdown', 'json')
  .action(async (query, options) => {
    try {
      const result = await prefetchContext(query, {
        topK: parseInt(options.topK),
        sources: options.sources.split(','),
        includeGrep: options.includeGrep,
        grepPath: options.grepPath,
      });

      if (options.format === 'markdown') {
        console.log(formatAsMarkdown(result.blocks));
        console.error(`\n[Fetched ${result.summary.totalResults} blocks in ${result.summary.queryTime}ms]`);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
```

**Step 2: Verify syntax**

Run: `node -c /tmp/llm-context/packages/librarian/cli.js`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/librarian/cli.js
git commit -m "feat(librarian): add CLI with json/markdown output"
```

---

## Task 4: Librarian Package - Register in Root CLI

**Files:**
- Modify: `cli.js`

**Step 1: Add librarian command to root CLI**

In `/tmp/llm-context/cli.js`, after the chat commands section (around line 308), add:

```javascript
// Librarian
program
  .command('prefetch <query>')
  .description('Pre-fetch context from memory + chat + telegram')
  .option('-k, --top-k <number>', 'Results per source', '5')
  .option('-s, --sources <list>', 'Comma-separated sources', 'memory,chat,telegram')
  .option('--include-grep', 'Include grep results', false)
  .option('--format <type>', 'Output format: json|markdown', 'json')
  .action(async (query, options) => {
    const { prefetchContext, formatAsMarkdown } = require('./packages/librarian');
    try {
      const result = await prefetchContext(query, {
        topK: parseInt(options.topK),
        sources: options.sources.split(','),
        includeGrep: options.includeGrep,
      });

      if (options.format === 'markdown') {
        console.log(formatAsMarkdown(result.blocks));
        console.error(`\n[Fetched ${result.summary.totalResults} blocks in ${result.summary.queryTime}ms]`);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });
```

**Step 2: Verify CLI works**

Run: `cd /tmp/llm-context && node cli.js prefetch --help`

Expected: Help text for prefetch command

**Step 3: Commit**

```bash
git add cli.js
git commit -m "feat(cli): register librarian prefetch command"
```

---

## Task 5: Always-Warm Router Script

**Files:**
- Create: `scripts/warm-router.sh`
- Create: `scripts/com.localllm.warm-router.plist`

**Step 1: Create warm-router.sh script**

Create `scripts/warm-router.sh`:

```bash
#!/usr/bin/env bash
# Keeps qwen2.5:7b router model loaded in Ollama by sending tiny prompts every 30min

set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
MODEL="${ROUTER_MODEL:-qwen2.5:7b}"
KEEP_ALIVE="60m"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

# Send a tiny prompt to keep the model loaded
warm_model() {
  log "Warming $MODEL (keep_alive=$KEEP_ALIVE)..."

  curl -s -X POST "$OLLAMA_URL/api/generate" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$MODEL\",
      \"prompt\": \"hi\",
      \"stream\": false,
      \"keep_alive\": \"$KEEP_ALIVE\"
    }" > /dev/null

  if [ $? -eq 0 ]; then
    log "✓ $MODEL is warm"
  else
    log "✗ Failed to warm $MODEL"
    exit 1
  fi
}

warm_model
```

**Step 2: Make script executable**

Run: `chmod +x /tmp/llm-context/scripts/warm-router.sh`

Expected: Script is executable

**Step 3: Create launchd plist template**

Create `scripts/com.localllm.warm-router.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.localllm.warm-router</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/tmp/llm-context/scripts/warm-router.sh</string>
    </array>

    <key>StartInterval</key>
    <integer>1800</integer>

    <key>StandardOutPath</key>
    <string>/tmp/localllm-warm-router.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/localllm-warm-router.err</string>

    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

**Step 4: Test script manually**

Run: `/tmp/llm-context/scripts/warm-router.sh`

Expected: Log message "✓ qwen2.5:7b is warm" (or error if model not available)

**Step 5: Commit**

```bash
git add scripts/warm-router.sh scripts/com.localllm.warm-router.plist
git commit -m "feat(scripts): add always-warm router with launchd template"
```

---

## Task 6: Embedding Cache - Database Migration

**Files:**
- Modify: `packages/search/indexer.js`

**Step 1: Add content_hash column to schema**

In `packages/search/indexer.js`, find the `initDb` function (around line 84) and update the CREATE TABLE statement:

```javascript
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
      content_hash TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);
    CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
  `);

  return db;
}
```

**Step 2: Verify syntax**

Run: `node -c /tmp/llm-context/packages/search/indexer.js`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/search/indexer.js
git commit -m "feat(search): add content_hash column for embedding cache"
```

---

## Task 7: Embedding Cache - Hash Computation

**Files:**
- Modify: `packages/search/indexer.js`

**Step 1: Import crypto module**

At the top of `packages/search/indexer.js` (around line 1), add:

```javascript
const { createHash } = require('crypto');
```

**Step 2: Add hash function**

After the `bufferToEmbedding` function (around line 22), add:

```javascript
function hashContent(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}
```

**Step 3: Export hashContent**

At the bottom of the file, update module.exports (around line 169):

```javascript
module.exports = {
  indexDirectory,
  initDb,
  embeddingToBuffer,
  bufferToEmbedding,
  chunkText,
  findMarkdownFiles,
  hashContent,
};
```

**Step 4: Verify syntax**

Run: `node -c /tmp/llm-context/packages/search/indexer.js`

Expected: No errors

**Step 5: Commit**

```bash
git add packages/search/indexer.js
git commit -m "feat(search): add content hash function"
```

---

## Task 8: Embedding Cache - Skip Logic

**Files:**
- Modify: `packages/search/indexer.js`

**Step 1: Implement cache lookup in indexDirectory**

In `packages/search/indexer.js`, find the `indexDirectory` function (around line 104). Replace the function with this implementation:

```javascript
async function indexDirectory(sourceDir, dbPath) {
  logger.info('Indexing memory files to SQLite...');
  const db = initDb(dbPath);

  // Build hash index of existing chunks for cache lookup
  const existingHashes = new Map();
  try {
    const existing = db.prepare('SELECT content_hash, embedding FROM chunks WHERE content_hash IS NOT NULL').all();
    for (const row of existing) {
      existingHashes.set(row.content_hash, row.embedding);
    }
    logger.debug(`Found ${existingHashes.size} cached embeddings`);
  } catch (err) {
    logger.debug(`No existing cache: ${err.message}`);
  }

  // Clear all chunks (we'll re-insert, but with cached embeddings where possible)
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

  logger.info(`Created ${allChunks.length} chunks, checking cache...`);

  // Compute hashes and check cache
  const chunksWithHashes = allChunks.map(chunk => ({
    ...chunk,
    hash: hashContent(chunk.text),
  }));

  let cacheHits = 0;
  let cacheMisses = 0;

  const chunksNeedingEmbedding = [];
  const chunksWithEmbeddings = [];

  for (const chunk of chunksWithHashes) {
    if (existingHashes.has(chunk.hash)) {
      // Cache hit! Reuse existing embedding
      chunksWithEmbeddings.push({
        ...chunk,
        embedding: existingHashes.get(chunk.hash),
      });
      cacheHits++;
    } else {
      // Cache miss - need to embed
      chunksNeedingEmbedding.push(chunk);
      cacheMisses++;
    }
  }

  logger.info(`Cache: ${cacheHits} hits, ${cacheMisses} misses`);

  // Embed cache misses
  if (chunksNeedingEmbedding.length > 0) {
    const BATCH_SIZE = 10;
    for (let i = 0; i < chunksNeedingEmbedding.length; i += BATCH_SIZE) {
      const batch = chunksNeedingEmbedding.slice(i, Math.min(i + BATCH_SIZE, chunksNeedingEmbedding.length));
      process.stdout.write(`\r  Embedding ${i + 1}-${i + batch.length}/${chunksNeedingEmbedding.length}`);

      try {
        const texts = batch.map(c => c.text);
        const response = await embed(config.models.embed, texts);

        for (let j = 0; j < batch.length; j++) {
          chunksWithEmbeddings.push({
            ...batch[j],
            embedding: embeddingToBuffer(response.embeddings[j]),
          });
        }
      } catch (err) {
        logger.error(`Error embedding batch: ${err.message}`);
      }
    }
    console.log('');
  }

  logger.info('Saving to SQLite...');

  const insert = db.prepare(`
    INSERT INTO chunks (file, start_line, end_line, text, embedding, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((chunks) => {
    for (const chunk of chunks) {
      insert.run(chunk.file, chunk.startLine, chunk.endLine, chunk.text, chunk.embedding, chunk.hash);
    }
  });

  insertMany(chunksWithEmbeddings);

  const count = db.prepare('SELECT COUNT(*) as count FROM chunks').get();
  logger.info(`Saved ${count.count} chunks to ${dbPath} (${cacheHits} from cache, ${cacheMisses} newly embedded)`);

  db.close();
}
```

**Step 2: Import `relative` from path (if not already imported)**

At the top of the file, ensure this line exists:

```javascript
const { join, relative } = require('path');
```

**Step 3: Verify syntax**

Run: `node -c /tmp/llm-context/packages/search/indexer.js`

Expected: No errors

**Step 4: Commit**

```bash
git add packages/search/indexer.js
git commit -m "feat(search): implement content-hash-based embedding cache"
```

---

## Task 9: Embedding Explorer - Backend API

**Files:**
- Modify: `packages/dashboard/server.js`

**Step 1: Add /api/embeddings/sample endpoint**

In `packages/dashboard/server.js`, after the `/api/search` endpoint (around line 93), add:

```javascript
app.get('/api/embeddings/sample', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  try {
    const Database = require('better-sqlite3');
    const dbPath = config.paths.searchDb;

    if (!existsSync(dbPath)) {
      return res.status(404).json({ error: 'Memory database not found. Run reindex first.' });
    }

    const db = new Database(dbPath, { readonly: true });
    const chunks = db.prepare('SELECT id, file, text, embedding FROM chunks ORDER BY RANDOM() LIMIT ?').all(limit);

    const samples = chunks.map(chunk => {
      const embedding = [];
      const buf = chunk.embedding;
      for (let i = 0; i < buf.length; i += 4) {
        embedding.push(buf.readFloatLE(i));
      }

      return {
        id: chunk.id,
        file: chunk.file,
        text: chunk.text.slice(0, 200), // Truncate for transfer
        embedding,
      };
    });

    db.close();
    res.json({ samples, count: samples.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Verify syntax**

Run: `node -c /tmp/llm-context/packages/dashboard/server.js`

Expected: No errors

**Step 3: Commit**

```bash
git add packages/dashboard/server.js
git commit -m "feat(dashboard): add embeddings sample API endpoint"
```

---

## Task 10: Embedding Explorer - Frontend Panel (HTML)

**Files:**
- Modify: `packages/dashboard/public/index.html`

**Step 1: Add Embedding Explorer card to HTML**

In `packages/dashboard/public/index.html`, find the section with other cards (after the search card). Add this card:

```html
<!-- Embedding Explorer -->
<section class="card" id="embeddings-card">
  <h2>🔮 Embedding Explorer</h2>
  <div style="margin-bottom: 1rem;">
    <label>Sample size: <input type="number" id="embed-limit" value="200" min="50" max="500" step="50" style="width: 80px;"></label>
    <button class="btn" onclick="loadEmbeddings()">Load</button>
    <span id="embed-status" style="margin-left: 1rem; color: var(--text2);"></span>
  </div>
  <div id="embeddings-content">
    <canvas id="embed-canvas" width="800" height="600" style="border: 1px solid var(--border); background: var(--bg); cursor: crosshair;"></canvas>
    <div id="embed-detail" style="margin-top: 1rem; padding: 0.5rem; background: var(--bg2); border-radius: var(--radius); min-height: 80px; display: none;">
      <strong id="embed-detail-file"></strong>
      <pre id="embed-detail-text" style="margin-top: 0.5rem; white-space: pre-wrap; font-size: 0.9em; color: var(--text2);"></pre>
    </div>
  </div>
</section>
```

**Step 2: Verify HTML syntax**

Visually inspect the HTML for unclosed tags and proper nesting

**Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): add embedding explorer HTML structure"
```

---

## Task 11: Embedding Explorer - Frontend Logic (JavaScript)

**Files:**
- Modify: `packages/dashboard/public/index.html`

**Step 1: Add loadEmbeddings function**

In `packages/dashboard/public/index.html`, in the `<script>` section, before the init function at the bottom, add:

```javascript
// Embedding Explorer
let embeddingSamples = [];
let embeddingProjection = [];

async function loadEmbeddings() {
  const limit = parseInt($('embed-limit').value) || 200;
  $('embed-status').textContent = 'Loading...';

  try {
    const res = await fetch(`/api/embeddings/sample?limit=${limit}`);
    const data = await res.json();

    if (data.error) {
      $('embed-status').textContent = `Error: ${data.error}`;
      return;
    }

    embeddingSamples = data.samples;

    // Simple 2D projection: pick two random dimensions
    const dim1 = Math.floor(Math.random() * embeddingSamples[0].embedding.length);
    const dim2 = Math.floor(Math.random() * embeddingSamples[0].embedding.length);

    embeddingProjection = embeddingSamples.map(s => ({
      x: s.embedding[dim1],
      y: s.embedding[dim2],
      file: s.file,
      text: s.text,
    }));

    // Normalize to canvas coordinates
    const xVals = embeddingProjection.map(p => p.x);
    const yVals = embeddingProjection.map(p => p.y);
    const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
    const yMin = Math.min(...yVals), yMax = Math.max(...yVals);

    const canvas = $('embed-canvas');
    const w = canvas.width, h = canvas.height;
    const padding = 40;

    embeddingProjection.forEach(p => {
      p.canvasX = padding + ((p.x - xMin) / (xMax - xMin)) * (w - 2 * padding);
      p.canvasY = padding + ((p.y - yMin) / (yMax - yMin)) * (h - 2 * padding);
    });

    drawEmbeddings();

    $('embed-status').textContent = `Loaded ${embeddingSamples.length} points (dims ${dim1}, ${dim2})`;
  } catch (err) {
    $('embed-status').textContent = `Error: ${err.message}`;
  }
}

function drawEmbeddings() {
  const canvas = $('embed-canvas');
  const ctx = canvas.getContext('2d');

  // Clear
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Group by file for color coding
  const fileColors = {};
  const uniqueFiles = [...new Set(embeddingProjection.map(p => p.file))];
  uniqueFiles.forEach((file, i) => {
    const hue = (i * 137.5) % 360; // Golden angle for color distribution
    fileColors[file] = `hsl(${hue}, 70%, 60%)`;
  });

  // Draw points
  embeddingProjection.forEach(p => {
    ctx.fillStyle = fileColors[p.file];
    ctx.beginPath();
    ctx.arc(p.canvasX, p.canvasY, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Canvas click handler
$('embed-canvas').addEventListener('click', (e) => {
  const canvas = $('embed-canvas');
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  // Find nearest point
  let nearest = null;
  let minDist = Infinity;

  for (const p of embeddingProjection) {
    const dist = Math.sqrt((p.canvasX - clickX) ** 2 + (p.canvasY - clickY) ** 2);
    if (dist < minDist && dist < 15) { // Within 15px
      minDist = dist;
      nearest = p;
    }
  }

  if (nearest) {
    $('embed-detail').style.display = 'block';
    $('embed-detail-file').textContent = nearest.file;
    $('embed-detail-text').textContent = nearest.text;
  } else {
    $('embed-detail').style.display = 'none';
  }
});
```

**Step 2: Add loadEmbeddings to init**

Find the init function (the last `(async () => { ... })()` block) and ensure `loadEmbeddings()` is called:

```javascript
(async () => {
  await Promise.all([
    loadStatus(),
    loadPackages(),
    loadJobs(),
    loadDaemons(),
    loadMemory(),
    loadClawdbotConfig(),
    loadConfig(),
    loadContextMonitor(),
    loadAgents(),
    loadConversation(),
    // Add this:
    loadEmbeddings(),
  ]);

  connectWs();

  // Refresh intervals...
})();
```

**Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): implement embedding explorer with 2D projection"
```

---

## Task 12: Embedding Explorer - CSS Styling

**Files:**
- Modify: `packages/dashboard/public/index.html`

**Step 1: Add CSS for embedding explorer**

In the `<style>` section of `packages/dashboard/public/index.html`, add:

```css
#embed-canvas {
  display: block;
  margin: 0 auto;
  border-radius: var(--radius);
}

#embed-detail {
  font-family: monospace;
  max-height: 300px;
  overflow-y: auto;
}

#embed-detail-file {
  color: var(--accent);
  font-size: 0.95em;
}
```

**Step 2: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "style(dashboard): add CSS for embedding explorer"
```

---

## Task 13: Integration Testing

**Files:**
- None (manual testing)

**Step 1: Test librarian CLI**

Run: `cd /tmp/llm-context && node cli.js prefetch "test query" --format json`

Expected: JSON output with blocks array (or empty if no databases exist)

**Step 2: Test warm-router script**

Run: `/tmp/llm-context/scripts/warm-router.sh`

Expected: Log message "✓ qwen2.5:7b is warm" (or error if model not available)

**Step 3: Test dashboard embedding explorer**

Run:
1. `cd /tmp/llm-context && node cli.js dashboard`
2. Open browser to `http://localhost:3847`
3. Navigate to Embedding Explorer panel
4. Click "Load" button

Expected: Canvas with colored points (or error if database empty)

**Step 4: Test embedding cache with reindex**

Run:
1. `cd /tmp/llm-context && node cli.js reindex`
2. Check log output for "Cache: X hits, Y misses"
3. Run `node cli.js reindex` again
4. Verify cache hits increased on second run

Expected: Second reindex should show cache hits, faster execution

**Step 5: Document any issues**

If any tests fail, note the error and context for debugging

---

## Task 14: Documentation Updates

**Files:**
- Create: `packages/librarian/README.md`
- Modify: `package.json`

**Step 1: Create librarian README**

Create `packages/librarian/README.md`:

```markdown
# Librarian Package

Pre-fetches context from multiple sources (memory, chat, telegram) for prompt injection.

## Usage

```javascript
const { prefetchContext, formatAsMarkdown } = require('@localllm/librarian');

const result = await prefetchContext('user query', {
  topK: 5,
  sources: ['memory', 'chat', 'telegram'],
  includeGrep: false,
});

console.log(result.blocks); // Array of context blocks
console.log(result.summary); // Stats
```

## CLI

```bash
node cli.js prefetch "query text" --format markdown --top-k 5 --sources memory,chat
```

## Options

- `topK`: Number of results per source (default: 5)
- `sources`: Array of sources to search (default: ['memory', 'chat', 'telegram'])
- `includeGrep`: Include keyword grep results (default: false)
- `grepPath`: Path to grep if includeGrep=true (default: config.paths.memoryDir)
```

**Step 2: Add librarian to verify script**

In `/tmp/llm-context/package.json`, update the verify script (around line 13):

```json
"verify": "node -e \"require('./packages/embeddings'); require('./packages/classifier'); require('./packages/triage'); require('./packages/search'); require('./packages/transcriber'); require('./packages/librarian'); console.log('All packages load successfully')\""
```

**Step 3: Run verify**

Run: `cd /tmp/llm-context && npm run verify`

Expected: "All packages load successfully"

**Step 4: Commit**

```bash
git add packages/librarian/README.md package.json
git commit -m "docs: add librarian README and update verify script"
```

---

## Task 15: Final Commit and Notification

**Files:**
- None

**Step 1: Create final summary commit**

Run:
```bash
git log --oneline -15
```

Review the commits to ensure all tasks are represented.

**Step 2: Tag the work**

Run:
```bash
git tag -a v1.1.0-context-optimization -m "Context & memory optimization layer: librarian, warm-router, embedding cache, embedding explorer"
```

**Step 3: Notify completion**

Run:
```bash
clawdbot system event --text "context-done" --mode now
```

Expected: Clawdbot acknowledges the completion event

---

## Notes

- **Librarian** aggregates results from memory.db (markdown chunks), chat-memory.db (session chunks), and telegram chunks using the existing unified search
- **Warm router** keeps qwen2.5:7b loaded via periodic curl to Ollama's generate endpoint with 60m keep_alive
- **Embedding cache** uses SHA-256 content hashes to skip re-embedding unchanged chunks, stored in new `content_hash` column
- **Embedding explorer** visualizes embeddings as a 2D scatter plot using two random dimensions, color-coded by source file
- All components integrate seamlessly with existing packages and config system
- Dashboard panel adds zero-config visual exploration of embedding space
- **Security:** Uses `execFile` with argument arrays (not `exec`) to prevent shell injection

## Testing Checklist

- [ ] Librarian CLI returns results
- [ ] Librarian formats as JSON and markdown
- [ ] Warm-router script runs without error
- [ ] Dashboard embedding explorer loads and renders
- [ ] Clicking points in explorer shows detail
- [ ] Reindex shows cache hits on second run
- [ ] All verify script passes

---

**Plan saved to:** `docs/plans/2026-01-29-context-memory-optimization.md`
