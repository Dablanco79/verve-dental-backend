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
cd Backend
cp .env.example .env
npm install
npm run dev
```

Health check: `GET http://localhost:3000/api/v1/health`

## Development scripts (Backend)

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
