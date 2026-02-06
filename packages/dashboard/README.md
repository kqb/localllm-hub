# LocalLLM Dashboard

React-based monitoring dashboard for LocalLLM Hub.

## Tech Stack

- **React 18** with TypeScript (strict mode)
- **Zustand** for state management
- **TanStack Query** (React Query) for data fetching
- **Tailwind CSS** for styling
- **Radix UI** for accessible headless components
- **Vite** for build tooling
- **Vitest** + React Testing Library for testing

## Development

```bash
# Install dependencies
npm install

# Start Vite dev server (port 3848)
npm run dev

# Start Express API server (port 3847)
node server.js

# Run tests
npm test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Type check
npm run type-check

# Lint
npm run lint
```

## Architecture

### Folder Structure

```
src/
├── __tests__/           # Test setup
├── api/                 # API client & TanStack Query hooks
├── components/          # React components
│   ├── ui/              # Base UI components (Button, Card, Badge)
│   ├── services/        # Service-specific components
│   ├── agents/          # Agent monitoring components
│   └── layout/          # Layout components (Header, TabBar)
├── hooks/               # Custom React hooks (useWebSocket, etc)
├── pages/               # Page components (Dashboard, Models, etc)
├── stores/              # Zustand stores
├── styles/              # Global styles
├── types/               # TypeScript type definitions
└── utils/               # Utility functions
```

### Key Principles

- **Modular**: Max 200 lines per file
- **Type-safe**: Strict TypeScript throughout
- **Tested**: 80%+ coverage target
- **Accessible**: Radix UI primitives
- **Real-time**: WebSocket integration for live updates

## Building for Production

```bash
# Build React app
npm run build

# Start Express server (serves built app)
NODE_ENV=production node server.js
```

## API Integration

The React app proxies API requests to the Express server:

- **Development**: Vite dev server (3848) → Express API (3847)
- **Production**: Express serves built React app + API (3847)

All API endpoints are available at `/api/*`:

- `GET /api/status` - Service status
- `GET /api/models` - Ollama models
- `GET /api/mlx/status` - MLX models
- `GET /api/context-monitor` - Context window stats
- `GET /api/agents` - Active agent sessions
- WebSocket at `/ws` for real-time updates

## Testing

Tests mirror the source structure:

```
src/components/ui/Button.tsx
src/components/ui/__tests__/Button.test.tsx
```

Run tests in watch mode during development:

```bash
npm test
```

## Theme

Dark theme with purple/pink accents matching the original dashboard:

- Background: `#0d1117`, `#161b22`, `#21262d`
- Text: `#e6edf3`, `#8b949e`
- Accent: `#58a6ff`
- Status colors: Green `#3fb950`, Red `#f85149`, Yellow `#d29922`
- Purple: `#bc8cff`, Orange: `#f0883e`
