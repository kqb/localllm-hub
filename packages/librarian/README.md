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
