# Verve Dental SaaS - PROJECT MEMORY

**Purpose:** This document is Cursor's long-term memory source. Update it after each module completion to maintain architectural context across sessions.

**Last Updated:** June 2026  
**Current Phase:** Inventory & Scanning — Module 03 Session 4 complete  
**Grade:** Enterprise (Production-Ready, Australian-Compliant)  
**Status:** Development Phase - Module 03 complete (pending Module 04+)

---

## 🎯 Project Overview

**Project:** Verve Dental Operational Suite  
**Scope:** Multi-tenant dental practice management platform (inventory, rostering, payroll, forecasting)  
**Target Users:** 100+ dental clinics across Australia  
**Structure:** - `/Backend` (Node.js/TypeScript server and database logic)
- `/Frontend-Web` (React Web App for desktops)
- `/Mobile-app` (React Native App for iOS/Android scanning/roster checking)

---

## 📊 Current Architecture Status

### Completed Modules
- [x] 00 MASTER SYSTEM PROMPT (Governing rules)
- [x] 01 CORE PLATFORM FOUNDATION (Scaffolding + post-review fixes)
- [x] 02 SECURITY & MULTI-TENANT (JWT auth, RBAC, tenant isolation)

### Repository Status (Root)
- [x] `.cursorignore` — excludes `node_modules/` from Cursor context
- [x] Root `.gitignore` — monorepo-wide ignore rules
- [x] Root `README.md` — project overview and branch strategy
- [x] Root `package.json` — npm workspaces (`Backend`, `Frontend-Web`)
- [x] `.editorconfig` — shared editor conventions
- [x] `.github/workflows/ci.yml` — monorepo lint, typecheck, test, web build
- [x] `docs/adr/` — ADR-001 multi-tenant architecture recorded
- [x] `Mobile-app/` — placeholder README (React Native scaffold deferred)
- [x] Git repository initialized — `main` + `dev` branches

### Frontend-Web Status (`/Frontend-Web`)
- [x] React 19 + TypeScript (strict) + Vite 6 scaffold
- [x] Login page + MFA step + protected dashboard routes
- [x] `AuthProvider` session restore via access/refresh tokens
- [x] API client: login, MFA verify, refresh, logout, `/auth/me`
- [x] Inventory page (`/inventory`) — stock table, manual scan form, API wired

### Backend Status (`/Backend`)
- [x] Node.js + TypeScript project scaffold
- [x] JWT auth: 15m access + 7d refresh tokens
- [x] RBAC roles: `owner_admin`, `group_practice_manager`, `clinical_staff`
- [x] Tenant middleware: clinic-scoped routes + owner cross-clinic access
- [x] MFA gate for privileged roles (dev code `000000`)
- [x] Structured auth audit logging (Pino)
- [x] In-memory user repository (seed dev accounts) — replaced by PostgreSQL in Module 13
- [x] `AppError` + hardened error handler
- [x] CORS restricted to `CORS_ORIGIN`
- [ ] PostgreSQL client + migrations (Module 13)
- [ ] Database RLS policies (Module 13)

### Dev seed accounts (password: `password123`)
| Email | Role | Clinic | MFA |
|-------|------|--------|-----|
| `admin@clinic-a.au` | owner_admin | Clinic A | Yes (`000000`) |
| `manager@clinic-a.au` | group_practice_manager | Clinic A | Yes (`000000`) |
| `staff@clinic-a.au` | clinical_staff | Clinic A | No |
| `admin@clinic-b.au` | owner_admin | Clinic B | No |

### Architectural Conventions (established in Module 01 review)
- **Throwing errors:** Always use `AppError` for operational errors (auth, validation, not-found). Raw `Error` is for unexpected/programmer errors only.
- **CORS:** Controlled by `CORS_ORIGIN` env var. Never use `cors()` with no options.
- **Production safety:** Error handler redacts `.message` from unhandled errors in `NODE_ENV=production`.
- **Frontend API base:** `VITE_API_BASE_URL=""` (empty) means same-origin via Vite proxy. Set to full URL in production.
- **Auth:** Access token in `Authorization: Bearer`. Refresh token stored client-side until Module 02 hardening (httpOnly cookies planned for production).

### Module 03 — Inventory & Scanning (in progress)

#### Session 1 complete — Schema, repositories, seed data
- [x] SQL migrations: `002_inventory_schema.up.sql` + `.down.sql`
- [x] Types: `src/types/inventory.ts`
- [x] `CatalogRepository` — master catalog + barcode mappings (in-memory)
- [x] `InventoryRepository` — clinic stock, adjustments, draft PO lines (in-memory)
- [x] Seed data: 5 master SKUs, 6 barcodes, 10 clinic inventory rows (A + B)
- [x] Wired into `createAppDependencies()`
- [x] Repository tests (`tests/inventoryRepository.test.ts`)

#### Seed inventory highlights
| Clinic | Low-stock items (below reorder) |
|--------|--------------------------------|
| Clinic A | Nitrile gloves (3/5), Face masks (2/4) |
| Clinic B | Diamond burs (1/3) |

#### Dev barcodes (EAN-13 / GS1 / QR / Code128 / Data Matrix)
| Barcode | SKU |
|---------|-----|
| `9301234567890` | VRV-GLV-001 |
| `9301234567891` | VRV-BUR-001 |
| `VRV-CMP-001` (QR) | VRV-CMP-001 |
| `VRVEJT001` (Code128) | VRV-EJT-001 |
| `9301234567894` (Data Matrix) | VRV-MSK-001 |

#### Session 2 complete — Inventory API + RBAC + OpenAPI
- [x] `InventoryService` — list, get, adjust, audit history
- [x] `InventoryController` + `inventoryRoutes.ts`
- [x] Endpoints:
  - `GET /clinics/:clinicId/inventory`
  - `GET /clinics/:clinicId/inventory/:itemId`
  - `POST /clinics/:clinicId/inventory/adjust` (owner_admin, group_practice_manager)
  - `GET /clinics/:clinicId/inventory/adjustments` (owner_admin, group_practice_manager)
- [x] RBAC: clinical_staff read-only; managers/admins can adjust + view audit
- [x] OpenAPI v0.3.0 inventory schemas + paths
- [x] API tests (`tests/inventoryApi.test.ts`) — 10 tests (incl. group_practice_manager RBAC)

#### Session 3 complete — Barcode parser + handleScan + scan API
- [x] `barcodeParser` utility — format detection, GS1 GTIN extraction, lookup key fallbacks
- [x] `ScanService.handleScan` — deduct stock, `scan_deduct` audit, draft PO on reorder breach
- [x] `ScanController` + `scanRoutes.ts`
- [x] `POST /clinics/:clinicId/scans` (all authenticated roles)
- [x] OpenAPI v0.4.0 scan schemas + path
- [x] Tests: `barcodeParser.test.ts` (8), `scanApi.test.ts` (9)

#### Session 4 complete — Frontend-Web inventory UI
- [x] `/inventory` route (protected)
- [x] `InventoryPage` — stock tracking table with low-stock badges
- [x] `ScanForm` — manual barcode input, format hint, quantity, deduct/receive toggle
- [x] `AddProductPage` (`/inventory/products/new`) — manager/admin product creation form
- [x] API client: `listInventory`, `handleScan`, `createProduct`
- [x] Backend: `POST /clinics/:clinicId/products`, scan `mode: receive|deduct`
- [x] App shell nav (Dashboard / Inventory)
- [x] Tests: `InventoryPage.test.tsx` (2), `AddProductPage.test.tsx` (2)

### Next Planned Upgrades
- [ ] 04+ per master module plan (rostering, payroll, etc.)
