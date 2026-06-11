# Frontend-Web

React web application for desktop clinic operations.

## Stack

- React 19 + TypeScript (strict mode)
- Vite 6 (dev server + production build)
- Vitest + React Testing Library
- API client stub (OpenAPI-generated client in a later module)

## Quick start

From the repository root:

```bash
npm install
npm run dev:web
```

Or from this directory:

```bash
npm install
npm run dev
```

App: `http://localhost:5173`  
API proxy: `/api/*` → `http://localhost:3000`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview production build |
| `npm run test` | Run Vitest unit tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript without emit |

## Folder layout

```
src/
├── api/          API client stub
├── components/   Shared UI components
├── config/       Environment config
├── pages/        Route-level views
└── types/        Shared TypeScript types
```
