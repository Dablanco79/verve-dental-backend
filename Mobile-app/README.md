# Mobile-app

React Native application for iOS and Android (barcode scanning, roster checks).

**Status:** Placeholder — scaffolding will be added in a later Module 01 phase.

## Planned stack

- React Native + TypeScript (strict mode)
- Offline sync (SQLite / WatermelonDB — see ADR-003)
- OpenAPI-generated API client

## API configuration

Live backend: `https://verve-dental-api.onrender.com`

- `config/api.ts` — shared constant until env wiring is added
- `.env.example` — template for future React Native env integration
