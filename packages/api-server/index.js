const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Metrics storage
const metrics = {
  requests: {},
  embeddings: { total: 0, totalTime: 0 },
  startTime: Date.now(),
};

// Metrics middleware
app.use((req, res, next) => {
  const start = Date.now();
  const endpoint = `${req.method} ${req.path}`;

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!metrics.requests[endpoint]) {
      metrics.requests[endpoint] = { count: 0, totalTime: 0, avgTime: 0 };
    }
    metrics.requests[endpoint].count++;
    metrics.requests[endpoint].totalTime += duration;
    metrics.requests[endpoint].avgTime =
      metrics.requests[endpoint].totalTime / metrics.requests[endpoint].count;
  });

  next();
});

// Health check
app.get('/v1/health', async (req, res) => {
  try {
    const { client } = require('../../shared/ollama');
    const response = await fetch('http://127.0.0.1:11434/', {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    const ok = response.ok;

    res.json({
      status: 'ok',
      ollama: ok ? 'connected' : 'unreachable',
      uptime: Date.now() - metrics.startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      ollama: 'unreachable',
      error: error.message,
      uptime: Date.now() - metrics.startTime,
      timestamp: new Date().toISOString(),
    });
  }
});

// Embeddings endpoint
app.post('/v1/embed', async (req, res) => {
  const start = Date.now();
  try {
    const { text, texts } = req.body;
    const { embed, batchEmbed } = require('../embeddings');

    if (!text && !texts) {
      return res.status(400).json({ error: 'Either "text" or "texts" required' });
    }

    let result;
    if (texts) {
      result = await batchEmbed(texts);
      metrics.embeddings.total += texts.length;
    } else {
      result = await embed(text);
      metrics.embeddings.total += 1;
    }

    const duration = Date.now() - start;
    metrics.embeddings.totalTime += duration;

    res.json({
      embeddings: Array.isArray(result) ? result : [result],
      count: Array.isArray(result) ? result.length : 1,
      duration,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Classification endpoint
app.post('/v1/classify', async (req, res) => {
  try {
    const { from, subject, body, labels } = req.body;
    const { classify } = require('../classifier');

    const email = {
      from: from || '',
      subject: subject || '',
      body: body || '',
      labels: labels || [],
    };

    const result = await classify(email);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Triage endpoint
app.post('/v1/triage', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing "text" field' });
    }

    const { rateUrgency } = require('../triage');
    const result = await rateUrgency(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route endpoint
app.post('/v1/route', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Missing "prompt" field' });
    }

    const { routeTask } = require('../triage');
    const result = await routeTask(prompt);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search endpoint
app.post('/v1/search', async (req, res) => {
  try {
    const { query, sources = ['memory', 'chat', 'telegram'], topK = 5 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Missing "query" field' });
    }

    const { unifiedSearch } = require('../chat-ingest/unified-search');
    const results = await unifiedSearch(query, { topK, sources });

    res.json({
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Metrics endpoint
app.get('/v1/metrics', (req, res) => {
  const uptime = Date.now() - metrics.startTime;
  const endpoints = Object.entries(metrics.requests).map(([endpoint, stats]) => ({
    endpoint,
    ...stats,
  }));

  res.json({
    uptime,
    uptimeHuman: `${Math.floor(uptime / 1000 / 60)} minutes`,
    embeddings: {
      total: metrics.embeddings.total,
      avgTime: metrics.embeddings.total > 0
        ? Math.round(metrics.embeddings.totalTime / metrics.embeddings.total)
        : 0,
    },
    endpoints: endpoints.sort((a, b) => b.count - a.count),
  });
});

function start(port = 3848) {
  app.listen(port, '127.0.0.1', () => {
    console.log(`\n🚀 LocalLLM API Server`);
    console.log(`   http://127.0.0.1:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`   GET  /v1/health`);
    console.log(`   POST /v1/embed`);
    console.log(`   POST /v1/classify`);
    console.log(`   POST /v1/triage`);
    console.log(`   POST /v1/route`);
    console.log(`   POST /v1/search`);
    console.log(`   GET  /v1/metrics`);
    console.log(`\nPress Ctrl+C to stop\n`);
  });
}

module.exports = { app, start };
