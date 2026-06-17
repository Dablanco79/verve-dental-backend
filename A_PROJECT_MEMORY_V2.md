# Verve Dental Operational Suite — Project Memory V2

**Purpose:** This is the authoritative source of truth for the project. Update after every significant session.  
**Supersedes:** `A_PROJECT_MEMORY.md` (outdated as of June 17, 2026)  
**Last Updated:** June 17, 2026  
**Current Phase:** Post-MVP Hardening — Payroll, Timesheets, Leave, Billing, and Analytics frontend complete  
**Grade:** Enterprise (Production-Candidate, Australian-Compliant)  
**Backend Tests:** ~321 tests estimated (exact: run `npm test`)  
**TypeScript Errors:** 0 (both workspaces at last confirmed state)

---

## 1. Executive Summary

The Verve Dental Operational Suite is a multi-tenant SaaS platform for Australian dental practices. It manages inventory, rostering, payroll, billing, and analytics for 100+ clinics. The platform is structured as an npm workspace monorepo comprising a Node.js/TypeScript backend, a React 19 web application, and a React Native mobile app scaffold.

As of June 17, 2026, the core business logic layer is complete. All primary modules (auth, inventory, scanning, purchase orders, roster, timesheets, leave, billing, analytics, forecasting) have backend service implementations, dual-mode Postgres/in-memory repositories, mounted API routes, and corresponding frontend pages. The platform is functional for internal development use but requires security hardening (RLS, TOTP), payment gateway integration, and deployment configuration before external clinic deployment.

**Overall production readiness: approximately 55%.**

---

## 2. Current Architecture

### Monorepo Structure

```
/
├── Backend/                  Node.js + TypeScript API server
│   ├── src/
│   │   ├── bootstrap/        Dependency injection (createAppDependencies)
│   │   ├── config/           Environment config
│   │   ├── controllers/      HTTP request handlers (Zod-validated)
│   │   ├── db/               Pool, migrations runner, seed
│   │   ├── middleware/        Auth, error handler
│   │   ├── redis/            Redis client (optional caching)
│   │   ├── repositories/     Interface + in-memory + Postgres implementations
│   │   ├── routes/           Express router factories
│   │   ├── services/         Business logic
│   │   ├── types/            Domain types
│   │   └── utils/            asyncHandler, barcodeParser, cors, csvUtils, logger, validation
│   ├── migrations/           Standalone SQL files (RLS not yet applied)
│   └── tests/                Jest test suites
├── Frontend-Web/             React 19 + TypeScript + Vite 6
│   ├── src/
│   │   ├── api/              Centralized API client (client.ts — 22 KB)
│   │   ├── auth/             AuthContext + ProtectedRoute
│   │   ├── components/       Layout (AppShell), Forecast components
│   │   ├── hooks/            Data-fetching hooks per domain
│   │   ├── pages/            16 page components
│   │   ├── types/            Frontend domain types
│   │   └── utils/            roles.ts, etc.
│   └── tests/                Vitest test suites
├── Mobile-app/               Placeholder — React Native (not started)
├── docs/adr/                 Architecture Decision Records
├── .github/workflows/        CI: lint + typecheck + test + build
└── A_PROJECT_MEMORY.md       Previous (outdated) project memory
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend runtime | Node.js >= 20, TypeScript 5.8 (ESM) |
| Backend framework | Express 5.1 |
| Backend validation | Zod 3.x |
| Backend auth | jsonwebtoken (JWT), bcryptjs |
| Database | PostgreSQL (pg 8.x) with advisory-lock migration runner |
| Cache | Redis / ioredis (optional; graceful fallback) |
| Backend logging | Pino + pino-http |
| Backend security | helmet, express-rate-limit, CORS restricted |
| Frontend framework | React 19, React Router 7, TypeScript 5.8 |
| Frontend build | Vite 6 |
| Frontend testing | Vitest 3, @testing-library/react |
| Backend testing | Jest 29, Supertest |

### Architectural Conventions (permanent record)

- **Error handling:** `AppError(statusCode, code, message)` for operational errors. Raw `Error` for programmer errors only.
- **Money:** Integer AUD cents everywhere. No floats. GST stored as basis points (1000 = 10%).
- **Multi-tenancy:** `clinic_id` present on every tenant-scoped table. Application-layer `enforceTenantParam` + service-layer `assertTenantAccess` (defence-in-depth). PostgreSQL RLS will be the third layer (Module 13).
- **Repositories:** All 9 repositories implement a TypeScript interface and have both an in-memory and a Postgres implementation. Bootstrap selects via a DB connection probe.
- **Dual-mode bootstrap:** `createAppDependencies()` performs a `SELECT 1` probe. If Postgres is unreachable, all repositories fall back to in-memory (dev mode). Redis follows the same pattern.
- **Timezone safety:** All date arithmetic uses clinic-local IANA timezone. `toLocalDateString`, `addCalendarDays`, `localDayStartUTC` helpers avoid DST drift without external libraries.
- **Audit trail:** `auditService.recordAuditEvent()` is called fire-and-forget at all key mutation points (billing, roster, inventory). The analytics repository is the persistence layer.
- **CORS:** Restricted to `CORS_ORIGIN` env var. Never open-CORS.
- **Frontend API base:** `VITE_API_BASE_URL=""` (same-origin via Vite proxy in dev). Full URL in production.
- **Trust proxy:** `app.set('trust proxy', 1)` — Render load balancer real client IP.

---

## 3. Backend Status

### Services (all located in `Backend/src/services/`)

| Service | File Size | Status | Notes |
|---------|-----------|--------|-------|
| `auditService.ts` | 1.7 KB | Complete | Fire-and-forget audit event writer |
| `authService.ts` | 11.6 KB | Complete | JWT, bcrypt, MFA (dev bypass), rate limiting |
| `userService.ts` | 4.4 KB | Complete | RBAC user management, password reset |
| `inventoryService.ts` | 3.9 KB | Complete | Stock CRUD, adjustments, audit |
| `scanService.ts` | 6.7 KB | Complete | Barcode deduct, auto draft-PO creation |
| `productService.ts` | 3.9 KB | Complete | Catalog item management |
| `purchaseOrderService.ts` | 6.0 KB | Complete | List, submit, CSV export |
| `clinicService.ts` | 3.5 KB | Complete | Clinic entity CRUD with RBAC |
| `rosterService.ts` | 11.0 KB | Complete | Shift CRUD, cross-clinic access, audit |
| `forecastService.ts` | 20.4 KB | Complete | Materials consumption forecasting, timezone-safe |
| `laborForecastService.ts` | 24.4 KB | Complete | Labor cost projection, integer cents |
| `timesheetService.ts` | 31.3 KB | Complete | Dual payroll tracks, approval workflow, commission logs |
| `leaveService.ts` | 10.2 KB | Complete | Leave request lifecycle, roster block check |
| `billingService.ts` | 20.8 KB | Complete (Session 1) | Full invoice/payment lifecycle; gateway not wired |
| `analyticsService.ts` | 14.8 KB | Complete (Session 1) | KPI aggregation; cross-clinic reports not built |

### Repositories (all in `Backend/src/repositories/`)

Every repository pair implements a TypeScript interface:

| Repository | Interface | In-Memory | Postgres |
|-----------|-----------|-----------|---------|
| userRepository | Yes | Yes | Yes |
| catalogRepository | Yes | Yes | Yes |
| clinicRepository | Yes | Yes | Yes |
| inventoryRepository | Yes | Yes | Yes |
| rosterRepository | Yes | Yes | Yes |
| timesheetRepository | Yes | Yes | Yes |
| leaveRepository | Yes | Yes | Yes |
| billingRepository | Yes | Yes | Yes |
| analyticsRepository | Yes | Yes | Yes |

### Routes (all mounted in `Backend/src/routes/index.ts`)

| Path Prefix | Router Factory | Status |
|------------|---------------|--------|
| `GET /health` | inline | Complete |
| `/auth/*` | createAuthHandlers | Complete |
| `/clinics/:id/inventory` | createInventoryRouter | Complete |
| `/clinics/:id/scans` | createScanRouter | Complete |
| `/clinics/:id/products` | createProductRouter | Complete |
| `/clinics/:id/users` | createUserRouter | Complete |
| `/clinics/:id/purchase-orders` | createPurchaseOrderRouter | Complete |
| `/clinics/:id/roster` | createRosterRouter | Complete |
| `/clinics/:id/forecast` | createForecastRouter + createLaborForecastRouter | Complete |
| `/clinics/:id/timesheets` | createTimesheetRouter | Complete |
| `/clinics/:id/leave` | createLeaveRouter | Complete |
| `/clinics/:id/billing` | createBillingRouter | Complete |
| `/clinics/:id/analytics` | createAnalyticsRouter | Complete |
| `/clinics/:id` (GET/PATCH) | createClinicRouter | Complete |

---

## 4. Frontend Status

### Pages (`Frontend-Web/src/pages/`)

All 16 pages are implemented and registered in `App.tsx` under `ProtectedRoute`.

| Page | Route | Approximate Size | Hook(s) Used | Status |
|------|-------|----------|--------------|--------|
| LoginPage | `/login` | Small | None (form) | Complete |
| HomePage | `/` | Small | None (static) | Complete |
| InventoryPage | `/inventory` | 9 KB | API client direct | Complete |
| AddProductPage | `/inventory/products/new` | 14 KB | API client direct | Complete |
| ManageUsersPage | `/users` | 12 KB | API client direct | Complete |
| PurchaseOrdersPage | `/purchase-orders` | 20 KB | API client direct | Complete |
| RosterCalendarPage | `/roster` | 20 KB | API client direct | Complete |
| MyShiftsPage | `/my-shifts` | 6 KB | API client direct | Complete |
| AccountPage | `/account` | 5 KB | API client direct | Complete |
| LaborForecastPage | `/forecast/labor` | 5 KB | `useLaborForecast` | Complete |
| ClinicSettingsPage | `/settings/clinic` | 20 KB | API client direct | Complete |
| TimesheetsPage | `/timesheets` | 28 KB | `useTimesheets` | Complete |
| LeavePage | `/leave` | 22 KB | `useLeave` | Complete |
| BillingLedgerPage | `/billing` | 20 KB | `useBilling` | Complete |
| AnalyticsDashboardPage | `/analytics` | 9 KB | `useAnalyticsDashboard` | Complete |
| AuditTrailPage | `/analytics/audit` | 10 KB | `useAuditEvents` | Complete |

### Components (`Frontend-Web/src/components/`)

| Component | Purpose | Status |
|-----------|---------|--------|
| `layout/AppShell.tsx` | Navigation shell with role-gated links | Complete |
| `forecast/LaborForecastSummaryCard.tsx` | KPI cards for labor projection | Complete |
| `forecast/LaborForecastTable.tsx` | Sortable role projection table | Complete |

### API Client (`Frontend-Web/src/api/client.ts` — 22 KB)

All backend endpoints have corresponding client methods. Methods cover: auth, inventory, scanning, products, purchase orders, roster, timesheets, leave, billing, analytics, audit events, labor forecast, clinic settings, user management.

### Hooks (`Frontend-Web/src/hooks/`)

| Hook | Domain | Status |
|------|--------|--------|
| `useLaborForecast.ts` | Labor cost projection | Complete |
| `useBilling.ts` | Billing ledger | Complete |
| `useTimesheets.ts` | Timesheet approval queue | Complete |
| `useLeave.ts` | Leave request management | Complete |
| `useAnalyticsDashboard.ts` | KPI dashboard | Complete |
| `useAuditEvents.ts` | Audit trail | Complete |

---

## 5. Database Status

### Applied Bootstrap Migrations (12 total)

Managed by `Backend/src/db/migrate.ts` using advisory locks for concurrent-safe startup.

| Order | ID | Key Tables/Changes |
|-------|----|--------------------|
| 1 | 003_users_schema | `users` (id, email, password_hash, role, home_clinic_id, mfa_enabled) |
| 2 | 004_rename_clinic_to_home_clinic | Rename idempotent column fix |
| 3 | 005_inventory_schema | `master_catalog_items`, `barcode_mappings`, `clinic_inventory_items`, `inventory_adjustments`, `draft_purchase_orders`, `draft_po_lines` |
| 4 | 006_roster_schema | `roster_entries`, `roster_entry_audit` |
| 5 | 007_roster_performance_indexes | Partial indexes for active shift queries |
| 6 | 008_payroll_and_leave_schema | `timesheet_entries`, `leave_requests` |
| 7 | 009_user_payroll_track | `users.payroll_track` column |
| 8 | 010_leave_requests_staff_email | `leave_requests.staff_email` column |
| 9 | 011_commission_log_state_check | DB-layer attendance constraint (NOT VALID) |
| 10 | 012_clinics_schema | `clinics` (canonical entity with ABN, timezone, tier) |
| 11 | 013_billing_schema | `invoices`, `invoice_number_sequences`, `invoice_line_items`, `payment_records` |
| 12 | 014_analytics_audit_schema | `audit_events` append-only table |

### Pending Migration Work

| File | Status | Notes |
|------|--------|-------|
| `migrations/001_tenant_rls_foundation.sql` | **Not applied** | PostgreSQL RLS policies — critical security hardening |
| `migrations/011_payroll_commission_constraint.up.sql` | Separate file, not in bootstrap | Likely superseded by migration 011 in bootstrap |

### Seed Data

`Backend/src/db/seed.ts` seeds:
- Demo users (4 accounts, 2 clinics) — runs if `users` table empty
- Inventory catalog (5 SKUs, 6 barcodes, 10 stock rows) — runs if `master_catalog_items` empty
- Clinic A + Clinic B — called before users to satisfy FK constraints

### Key Schema Decisions (permanent record)

- **Integer cents:** All monetary values stored as integers. Never float.
- **GST snapshot:** `tax_rate_basis_points` stored at record creation time. Prevents retroactive recalculation.
- **Dual clinic context on timesheets:** `clinic_id` (payroll/home) and `rostered_clinic_id` (physical location) are separate columns, supporting cross-location deployments.
- **Commission log safeguard:** `attendance_status = 'pending_verification'` by default. A manager must explicitly verify before the forecasting engine counts attendance.
- **Defence-in-depth tenant isolation:** `clinic_id` present on invoice_line_items and payment_records (redundant) to prevent cross-tenant ID guessing.

---

## 6. Completed Features

### Core Platform
- JWT authentication (15m access + 7d refresh tokens)
- RBAC: `owner_admin`, `group_practice_manager`, `clinical_staff`
- MFA gate (dev bypass `000000` blocked in production)
- Tenant middleware: clinic-scoped routes + owner cross-clinic access
- Rate limiting on all auth endpoints
- Structured audit logging (Pino)

### Inventory & Scanning
- Master catalog with barcode mappings (GS1, EAN-13, Code128, QR, Data Matrix)
- Per-clinic stock levels with reorder points
- Full adjustment audit trail (immutable append-only)
- Auto draft-PO creation on reorder point breach
- Purchase order submit workflow + CSV export

### Roster & Scheduling
- Full shift CRUD with TIMESTAMPTZ start/end
- Shift types: standard, overtime, on_call, training
- Status lifecycle: scheduled → confirmed → completed | cancelled
- Cross-clinic access: staff can view clinics where they have active shifts
- JSONB snapshot audit trail per roster entry change
- Frontend: weekly grid calendar with colour-coded shift cards, create/edit modal

### Timesheets & Payroll
- Dual payroll track: `hourly_auto`/`hourly_manual` (clock-in/out) + `commission_log` (provider attendance)
- Approval workflow: draft → submitted → approved/rejected/requires_amendment → processed
- Commission log auto-generation on roster completion
- Accounting-agnostic hour buckets (ordinary, overtime 1.5x, 2x, custom) for adapter layer

### Leave Management
- Leave types: annual, sick, personal, compassionate, unpaid, other
- Australian Fair Work compliant half-day support (decimal total_days)
- Approval workflow with manager review notes
- Roster block check for approved leave periods

### Billing & Invoicing
- Draft → issued → paid/partially_paid/overdue/void lifecycle
- Per-clinic sequential invoice numbering (atomic DB counter)
- GST calculation (basis points, snapshot at creation)
- Payment records: append-only ledger with positive/negative amounts (payments + refunds)
- Multi-tenant guard at both middleware and service layer

### Forecasting
- Materials consumption forecast from scan_deduct history (SQL predicate push-down)
- Labor cost projection with timezone-calibrated day boundaries
- Integer cents costs (no floats in projection outputs)
- Commission log attendance status governs material forecast inclusion

### Analytics & Audit
- KPI dashboard (30-day revenue, inventory, roster aggregates)
- Monthly revenue breakdown
- Paginated audit event trail with entity/actor drill-down
- Append-only audit events linked to all key mutation points

### Clinic Management
- Canonical clinic entity (ABN, IANA timezone, subscription tier, address)
- ABN validation (11 digits, normalised)
- Subscription tier: standard/premium/enterprise (read-only to clients)
- Clinic settings page (view for managers, edit for owner_admin)

---

## 7. Outstanding Features

### High Priority (Blocking Production)
- [ ] PostgreSQL RLS policies (`001_tenant_rls_foundation.sql` not yet applied)
- [ ] Real TOTP MFA (authenticator app) — dev bypass must be removed before production
- [ ] Refresh token persistence in Redis (current in-memory store breaks multi-instance)
- [ ] Deployment configuration (`render.yaml` or equivalent)

### High Priority (Business Value)
- [ ] Invoice PDF generation + email dispatch
- [ ] Payment gateway integration (Stripe or Tyro)
- [ ] Overdue invoice scheduler (auto-mark status on due_at expiry)
- [ ] Payroll export adapter (Xero / MYOB / KeyPay / CSV)

### Medium Priority
- [ ] Xero / MYOB invoice sync and payment reconciliation
- [ ] PO receiving workflow (mark received, auto-increment stock)
- [ ] Supplier email / EDI integration for submitted POs
- [ ] Cross-clinic analytics (owner_admin all-clinic roll-up)
- [ ] Audit event CSV export endpoint
- [ ] PO line editing before submit

### Lower Priority
- [ ] Patient management module (patient records, patient-invoice FK)
- [ ] Real-time TOTP MFA for privileged roles
- [ ] Mobile app (React Native — currently placeholder only)
- [ ] Frontend test coverage expansion (currently ~5 tests across 16 pages)
- [ ] API rate limiting on non-auth routes
- [ ] OpenAPI spec updates (stale at v0.4.0)

---

## 8. Technical Debt Register

| ID | Item | Severity | Action Required |
|----|------|----------|-----------------|
| TD-01 | PostgreSQL RLS not applied | **Critical** | Apply `001_tenant_rls_foundation.sql`; build Module 13 full RLS |
| TD-02 | Dev MFA bypass (`000000`) | **High** | Implement `otplib` TOTP; remove dev code path |
| TD-03 | Refresh tokens in-memory only | **High** | Migrate to Redis store (client already wired) |
| TD-04 | No deployment config in repo | **High** | Write `render.yaml` or platform equivalent |
| TD-05 | Frontend test coverage < 5% | **High** | Write Vitest tests for all 16 pages |
| TD-06 | No API rate limiting on data routes | Medium | Add `express-rate-limit` to inventory, billing, roster routes |
| TD-07 | OpenAPI spec stale (v0.4.0) | Medium | Update `api/openapi.yaml` to cover all modules |
| TD-08 | `home_clinic_name` denormalized on users | Medium | Cascade update on clinic rename or remove denorm |
| TD-09 | `invoices.patient_id` unenfored FK | Low | Build patient module and add FK constraint |
| TD-10 | Bootstrap runner (not CLI) | Low | Module 13: build proper migration CLI |
| TD-11 | No non-auth rate limiting | Low | Extend rate limiter to all writable endpoints |

---

## 9. Known Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Tenant data cross-contamination | Low (app guards) → High (no RLS) | Critical | Apply RLS before any external deployment |
| Dev MFA bypass in production | Medium | High | Env var gating exists; still must remove before go-live |
| Multi-instance auth failure | High (if multi-instance deployed) | High | Move refresh tokens to Redis immediately |
| Payroll compliance errors | Medium | High | Validate timesheet approval workflow against Fair Work requirements |
| GST rate change | Low | Medium | Basis-points snapshot mitigates; existing invoices unaffected |
| Clinic name drift | Medium | Low | Users denormalize `home_clinic_name`; may diverge from `clinics.name` |

---

## 10. Recent Major Milestones

| Date (Approx.) | Milestone |
|----------------|-----------|
| Jun 11, 2026 | Project scaffold, auth, security hotfix, inventory schema |
| Jun 12, 2026 | Inventory PostgreSQL persistence, user management, PO draft frontend |
| Jun 13, 2026 | Roster module (backend + frontend calendar) |
| Jun 13–14, 2026 | Payroll/timesheet schema (Module 05 Session 1); product page frontend |
| Jun 15, 2026 | Labor forecast frontend, leave management complete, timesheet service complete |
| Jun 15–16, 2026 | Billing module (Session 1), billing frontend, clinic settings frontend |
| Jun 16, 2026 | Analytics module (Session 1), analytics/audit frontend, pre-module hardening pass |
| Jun 17, 2026 | MVP hardening: PO submit workflow, CSV export, purchase order tests, CSV injection tests |

---

## 11. Next Recommended Build Order

### Immediate — Security (do these before any external deployment)
1. Apply PostgreSQL RLS (`001_tenant_rls_foundation.sql`)
2. Implement real TOTP MFA (`otplib` or equivalent)
3. Move refresh tokens to Redis store
4. Write `render.yaml` deployment config

### Short-Term — Business Value
5. Invoice PDF generation (PDFKit or wkhtmltopdf)
6. Overdue invoice scheduler (Node cron or external trigger)
7. Payment gateway integration (Stripe preferred)
8. Payroll export adapter (CSV initially; Xero after)

### Medium-Term — Platform Completeness
9. Expand frontend test coverage (Vitest + React Testing Library)
10. Cross-clinic analytics for owner_admin
11. PO receiving workflow
12. Supplier email integration

See `B_BUILD_ORDER_AND_ROADMAP_V2.md` for full phased roadmap.

---

## 12. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| Jun 2026 | Integer cents for all money | Eliminates floating-point rounding errors in financial calculations |
| Jun 2026 | GST as basis points snapshot | Prevents retroactive recalculation when GST rate changes |
| Jun 2026 | Unified `timesheet_entries` table (not split) | Forecasting engine needs single query surface across payroll types |
| Jun 2026 | Dual-mode repositories (Postgres + in-memory) | Enables local development without a database and CI tests without external dependencies |
| Jun 2026 | Advisory lock on migration runner | Prevents duplicate migration application when multiple app instances start concurrently |
| Jun 2026 | Commission logs created as `pending_verification` | Prevents phantom demand inflation in materials forecast |
| Jun 2026 | Labour cost stored as integer cents | Consistent with billing and inventory patterns; eliminates division issues |
| Jun 2026 | `home_clinic_id` vs `rostered_clinic_id` on timesheets | Payroll grouped by home clinic; physical work tracked via rostered_clinic_id |
| Jun 2026 | No RLS applied yet | Intentionally deferred to Module 13 to keep early development fast |
| Jun 2026 | `clinic_id` redundant on line_items + payments | Defence-in-depth: guessed invoice IDs cannot cross tenant boundaries |

---

## 13. Current Test Statistics

### Backend (Jest)

| Suite | File | Tests (approx.) |
|-------|------|----------|
| Payroll Integration | payrollPostgresIntegration.test.ts | 69 |
| Payroll Repository | payrollRepository.test.ts | 36 |
| Labor Forecast | laborForecastService.test.ts | 30 |
| Materials Forecast | forecastService.test.ts | 29 |
| Purchase Order API | purchaseOrderApi.test.ts | 29 |
| Billing Service | billingService.test.ts | 28 |
| Roster API | rosterApi.test.ts | 16 |
| PO Postgres Integration | purchaseOrderPostgresIntegration.test.ts | 17 |
| CSV Utils | csvUtils.test.ts | 15 |
| Scan API | scanApi.test.ts | 13 |
| Inventory API | inventoryApi.test.ts | 10 |
| Health | health.test.ts | 9 |
| Barcode Parser | barcodeParser.test.ts | 8 |
| Inventory Repository | inventoryRepository.test.ts | 6 |
| Product API | productApi.test.ts | 4 |
| PO CSV Injection | purchaseOrderCsvInjection.test.ts | 2 |
| **Total (estimated)** | | **~321** |

### Frontend (Vitest)

| Suite | Tests |
|-------|-------|
| App.test.tsx | ~1 |
| AddProductPage.test.tsx | 2 |
| InventoryPage.test.tsx | 2 |
| **Total** | **~5** |

**Frontend coverage is critically insufficient. 13 of 16 pages have zero tests.**

---

## 14. Deployment Status

| Item | Status |
|------|--------|
| CI pipeline | GitHub Actions — lint, typecheck, test, build (`main` + `dev`) |
| Target hosting | Render (trust proxy pattern implemented) |
| Deployment config file | **Not present** — render.yaml or Procfile not created |
| Database | PostgreSQL (Render managed recommended) |
| Redis | Optional; used for session caching; graceful degradation if absent |
| Staging environment | Not configured |
| Production URL | Not established |
| Environment variables | `.env.example` present (Backend); `.env.example` present (Frontend-Web) |

### Required Environment Variables (Backend)

```
DATABASE_URL          PostgreSQL connection string
JWT_SECRET            Access token signing secret
JWT_REFRESH_SECRET    Refresh token signing secret
CORS_ORIGIN           Allowed frontend origin
NODE_ENV              production | development | test
PORT                  Server port (default 3000)
REDIS_URL             (Optional) Redis connection string
```

---

## Dev Seed Accounts (password: `password123`)

| Email | Role | Clinic |
|-------|------|--------|
| admin@clinic-a.au | owner_admin | Clinic A |
| manager@clinic-a.au | group_practice_manager | Clinic A |
| staff@clinic-a.au | clinical_staff | Clinic A |
| admin@clinic-b.au | owner_admin | Clinic B |

> MFA is `mfa_enabled: false` in the dev seed. The dev MFA bypass code (`000000`) is blocked in `NODE_ENV=production`.
