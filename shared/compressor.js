const { readFileSync, readdirSync, statSync } = require('fs');
const { join, extname, relative } = require('path');
const { generate } = require('./ollama');

/**
 * Compress a single file into architectural summary
 * @param {string} filePath - Absolute path to file
 * @param {Object} opts - Options
 * @returns {Promise<Object>} - { path, summary, exports, imports, functions, tokens }
 */
async function compressFile(filePath, opts = {}) {
  const model = opts.model || 'qwen2.5:7b';
  const content = readFileSync(filePath, 'utf-8');

  if (content.length === 0) {
    return { path: filePath, summary: '(empty file)', exports: [], imports: [], functions: [], tokens: 0 };
  }

  const prompt = `You are a code distiller. Analyze this file and output ONLY a JSON object (no markdown, no explanation) with this schema:

{
  "summary": "1-sentence: what this file does",
  "exports": ["exported function/class names"],
  "imports": ["imported module names"],
  "functions": ["function signature without body"]
}

File: ${filePath}
\`\`\`
${content.slice(0, 8000)}
\`\`\`

JSON:`;

  try {
    const response = await generate(model, prompt, {
      temperature: 0.1,
      num_ctx: 8192,
    });

    const text = response.response.trim();
    let json;

    // Try to extract JSON from markdown code blocks
    const match = text.match(/```(?:json)?\n?([\s\S]+?)```/);
    if (match) {
      json = JSON.parse(match[1]);
    } else {
      json = JSON.parse(text);
    }

    return {
      path: filePath,
      summary: json.summary || '(no summary)',
      exports: json.exports || [],
      imports: json.imports || [],
      functions: json.functions || [],
      tokens: Math.ceil(content.length / 4), // rough estimate
    };
  } catch (error) {
    // Fallback: basic static analysis
    const lines = content.split('\n');
    const exports = [];
    const imports = [];
    const functions = [];

    for (const line of lines) {
      if (line.match(/^export (function|class|const|let|var)/)) {
        const match = line.match(/export (?:async )?(function|class|const|let|var) (\w+)/);
        if (match) exports.push(match[2]);
      }
      if (line.match(/^import .* from/)) {
        const match = line.match(/from ['"](.+?)['"]/);
        if (match) imports.push(match[1]);
      }
      if (line.match(/^(async )?function \w+/)) {
        functions.push(line.trim().replace(/\{.*$/, '').trim());
      }
    }

    return {
      path: filePath,
      summary: `File with ${lines.length} lines`,
      exports,
      imports,
      functions: functions.slice(0, 10), // limit to 10
      tokens: Math.ceil(content.length / 4),
      error: error.message,
    };
  }
}

/**
 * Compress an entire directory
 * @param {string} dirPath - Absolute path to directory
 * @param {Object} opts - { extensions: ['.js'], maxFiles: 50, model: 'qwen2.5:7b' }
 * @returns {Promise<Array>} - Array of compressed file summaries
 */
async function compressDirectory(dirPath, opts = {}) {
  const extensions = opts.extensions || ['.js', '.ts', '.jsx', '.tsx'];
  const maxFiles = opts.maxFiles || 50;
  const results = [];

  function walk(dir, depth = 0) {
    if (depth > 3) return; // max depth
    const entries = readdirSync(dir);

    for (const entry of entries) {
      if (results.length >= maxFiles) break;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (!entry.startsWith('.') && entry !== 'node_modules') {
          walk(fullPath, depth + 1);
        }
      } else if (stat.isFile() && extensions.includes(extname(entry))) {
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);

  console.error(`Compressing ${results.length} files...`);
  const summaries = [];

  for (let i = 0; i < results.length; i++) {
    const file = results[i];
    const relPath = relative(dirPath, file);
    console.error(`[${i + 1}/${results.length}] ${relPath}`);

    try {
      const compressed = await compressFile(file, opts);
      summaries.push(compressed);
    } catch (error) {
      console.error(`  ⚠️  Error: ${error.message}`);
      summaries.push({
        path: file,
        summary: `(compression failed: ${error.message})`,
        exports: [],
        imports: [],
        functions: [],
        tokens: 0,
        error: error.message,
      });
    }
  }

  const totalTokens = summaries.reduce((sum, s) => sum + (s.tokens || 0), 0);
  const compressedTokens = summaries.reduce((sum, s) => {
    const summary = s.summary + s.exports.join(',') + s.imports.join(',') + s.functions.join(',');
    return sum + Math.ceil(summary.length / 4);
  }, 0);

  console.error(`\nCompression: ${totalTokens} → ${compressedTokens} tokens (~${Math.round((1 - compressedTokens / totalTokens) * 100)}% reduction)`);

  return summaries;
}

module.exports = { compressFile, compressDirectory };
