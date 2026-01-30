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
