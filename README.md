# Verve Dental Operational Suite

Multi-tenant dental practice management platform for inventory, rostering, payroll, and forecasting across Australian clinics.

## Repository structure

```
/
├── Backend/          Node.js + TypeScript API (OpenAPI-first)
├── Frontend-Web/     React web application (desktop)
├── Mobile-app/       React Native app (iOS/Android)
├── docs/             Architecture decision records and runbooks
├── A_PROJECT_MEMORY.md
└── .github/workflows/ CI/CD pipelines
```

## Prerequisites

- Node.js >= 20
- PostgreSQL 15+ (Module 13)
- Redis (caching layer)

## Quick start (Backend)

```bash
npm install
npm run dev:backend
```

Health check: `GET http://localhost:3000/api/v1/health`

## Quick start (Frontend-Web)

```bash
npm install
npm run dev:web
```

App: `http://localhost:5173` (proxies `/api/*` to the Backend)

## Workspace scripts (root)

| Command | Description |
|---------|-------------|
| `npm run dev:backend` | Start Backend dev server |
| `npm run dev:web` | Start Frontend-Web dev server |
| `npm run build` | Build all workspaces |
| `npm run test` | Test all workspaces |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | Typecheck all workspaces |

## Development scripts (Backend)

```bash
cd Backend
cp .env.example .env
npm run dev
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run test` | Run Jest unit/integration tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript without emit |

## Branch strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `dev` | Integration branch (auto-deploy to development) |
| `feature/*` | Feature work |
| `fix/*` | Bug fixes |

## Documentation

- `A_PROJECT_MEMORY.md` — Cursor session memory and module progress
- `docs/adr/` — Architecture Decision Records
- `Backend/src/api/openapi.yaml` — API contract

## License

Proprietary — JD Group / Verve Dental
