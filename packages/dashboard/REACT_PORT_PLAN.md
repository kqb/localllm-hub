# Dashboard React Port Plan

## Current State Analysis

**Old HTML:** 31 functional cards/widgets (223KB)
**React:** ~6 component groups (~1400 lines total)

## Missing Widgets (Grouped for Parallel Work)

### Group A: Core Services & Status
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| status-card | /api/status | HIGH |
| models-card | /api/ollama/tags | HIGH |
| mlx-card | /api/mlx/status | MEDIUM |
| daemons-card | /api/daemons | MEDIUM |

### Group B: Context & Memory
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| context-card | /api/context | HIGH |
| context-pipeline-card | /api/context-pipeline/* | HIGH |
| memory-card | /api/memory/* | HIGH |
| memory-perf-card | /api/memory/stats | MEDIUM |
| rag-card | /api/rag/* | MEDIUM |

### Group C: Router & Routing
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| router-card | /api/router/* | HIGH |
| router-health-card | /api/router/health | HIGH |
| routes-card | /api/routes | MEDIUM |
| prompt-editor-card | /api/router/prompt | MEDIUM |

### Group D: Agents & Monitoring
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| agents-card | /api/agents/* | HIGH (partial) |
| alerts-card | /api/alerts/* | HIGH |
| zoid-activity-card | /api/zoid/* | HIGH (exists) |
| trust-card | /api/trust | MEDIUM |
| corrections-card | /api/corrections | MEDIUM |

### Group E: Tools & Search
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| chat-card | /api/chat/* | MEDIUM |
| search-card | /api/search | MEDIUM |
| embeddings-card | /api/embeddings/* | LOW |
| skills-card | /api/skills | LOW |

### Group F: Config & Settings
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| clawdbot-card | /api/clawdbot/* | HIGH |
| compaction-card | /api/compaction | HIGH |
| budget-card | /api/budget | MEDIUM |
| economics-card | /api/economics | LOW |

### Group G: Jobs & Pipelines
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| jobs-card | /api/jobs | MEDIUM |
| pipelines-card | /api/pipelines | MEDIUM |
| cron-card | /api/cron | LOW |
| sessions-card | /api/sessions | LOW |

### Group H: Model Management
| Widget | API Endpoint | Priority |
|--------|--------------|----------|
| model-mgr-card | /api/models/* | MEDIUM |

## React Component Structure (Target)

```
src/components/
├── agents/        ✅ exists (needs completion)
├── alerts/        🆕 new
├── context/       ✅ exists (needs expansion)
├── config/        🆕 new (clawdbot, compaction, budget)
├── memory/        🆕 new
├── mlx/           ✅ exists
├── models/        🆕 new (model-mgr)
├── pipelines/     🆕 new
├── router/        🆕 new
├── search/        🆕 new
├── services/      ✅ exists
├── tools/         🆕 new (chat, search, embeddings)
├── zoid/          ✅ exists
└── ui/            ✅ exists
```

## API Hooks Needed

Each widget needs a React Query hook. Create in `src/hooks/`:
- useStatus, useModels, useMLX, useDaemons
- useContext, useContextPipeline, useMemory, useRAG
- useRouter, useRoutes, usePrompt
- useAgents, useAlerts, useTrust, useCorrections
- useChat, useSearch, useEmbeddings, useSkills
- useClawdbot, useCompaction, useBudget
- useJobs, usePipelines, useCron, useSessions

## Parallel Agent Assignment

**Agent 1:** Group A + B (Services, Context, Memory) - 9 widgets
**Agent 2:** Group C + D (Router, Agents, Alerts) - 9 widgets  
**Agent 3:** Group E + F (Tools, Config) - 9 widgets
**Agent 4:** Group G + H (Jobs, Models) - 5 widgets

## Reference Files

- Old HTML: `public/index.html`
- Server APIs: `server.cjs`
- Existing React: `src/components/`

## Notes

- Copy styling/layout from old HTML exactly
- Use TanStack Query for data fetching
- WebSocket for real-time updates (agents, alerts)
- Tailwind CSS for styling (already configured)
