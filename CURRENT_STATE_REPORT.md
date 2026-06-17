# Current State Report — Verve Dental Operational Suite

**Prepared:** June 17, 2026  
**Scope:** Full repository audit — Backend, Frontend-Web, Mobile-app, CI, Database  
**Method:** Direct repository inspection. Evidence-based only.

---

## Executive Summary

The Verve Dental Operational Suite has advanced significantly beyond what the existing `A_PROJECT_MEMORY.md` describes. The project memory stalled after documenting Module 05 Schema Migration (Session 1) and Module 08 Analytics (Session 1), but the actual repository contains substantially more completed work. Timesheets, Leave Management, Billing frontend, and Analytics frontend are all implemented and routed — none of this is reflected in the existing documentation.

The platform is a functional multi-tenant dental practice management system with 16 live frontend pages, 15 backend service modules, 12 applied database migrations, and approximately 320+ backend tests. It is not yet production-ready due to four hard blockers: PostgreSQL RLS policies, real TOTP MFA, a deployed hosting environment, and missing payment gateway integrations.

---

## Part 1 — Completed Modules

### Backend — Fully Implemented and Routed

| Module | Service | Repository | Routes | Postgres Impl | Tests |
|--------|---------|-----------|--------|---------------|-------|
| Auth & JWT | `authService.ts` | `userRepository.ts` + `.postgres.ts` | `/auth/*` | Yes | Yes (health.test.ts) |
| User Management | `userService.ts` | `userRepository.ts` + `.postgres.ts` | `/clinics/:id/users` | Yes | Yes |
| Inventory (CRUD) | `inventoryService.ts` | `inventoryRepository.ts` + `.postgres.ts` | `/clinics/:id/inventory` | Yes | inventoryApi + inventoryRepository |
| Barcode Scanning | `scanService.ts` | via inventoryRepository | `/clinics/:id/scans` | Yes | scanApi.test.ts (13 tests) |
| Product Catalog | `productService.ts` | `catalogRepository.ts` + `.postgres.ts` | `/clinics/:id/products` | Yes | productApi.test.ts (4 tests) |
| Purchase Orders | `purchaseOrderService.ts` | via inventoryRepository | `/clinics/:id/purchase-orders` | Yes | purchaseOrderApi.test.ts (29 tests) + csvInjection (2 tests) |
| Roster & Scheduling | `rosterService.ts` | `rosterRepository.ts` + `.postgres.ts` | `/clinics/:id/roster` | Yes | rosterApi.test.ts (16 tests) |
| Materials Forecast | `forecastService.ts` | via inventoryRepository | `/clinics/:id/forecast/materials` | Yes | forecastService.test.ts (29 tests) |
| Labor Forecast | `laborForecastService.ts` | via rosterRepository | `/clinics/:id/forecast/labor` | Yes | laborForecastService.test.ts (30 tests) |
| Timesheets | `timesheetService.ts` | `timesheetRepository.ts` + `.postgres.ts` | `/clinics/:id/timesheets` | Yes | payrollRepository.test.ts (36 tests) + integration (69 tests) |
| Leave Management | `leaveService.ts` | `leaveRepository.ts` + `.postgres.ts` | `/clinics/:id/leave` | Yes | Covered in payroll tests |
| Billing & Invoicing | `billingService.ts` | `billingRepository.ts` + `.postgres.ts` | `/clinics/:id/billing` | Yes | billingService.test.ts (28 tests) |
| Clinic Settings | `clinicService.ts` | `clinicRepository.ts` + `.postgres.ts` | `/clinics/:id` (GET/PATCH) | Yes | — |
| Analytics & Audit | `analyticsService.ts` | `analyticsRepository.ts` + `.postgres.ts` | `/clinics/:id/analytics` | Yes | — |
| Audit Logging | `auditService.ts` | via analyticsRepository | Internal (fire-and-forget) | Yes | — |

### Frontend-Web — All 16 Pages Implemented and Routed

| Page | Route | Size | RBAC Gated | API Wired |
|------|-------|------|------------|-----------|
| LoginPage | `/login` | Small | No | Yes |
| HomePage | `/` | Small | Yes | No (static) |
| InventoryPage | `/inventory` | 9 KB | Yes | Yes |
| AddProductPage | `/inventory/products/new` | 14 KB | Yes | Yes |
| ManageUsersPage | `/users` | 12 KB | Admin/Mgr | Yes |
| PurchaseOrdersPage | `/purchase-orders` | 20 KB | Admin/Mgr | Yes |
| RosterCalendarPage | `/roster` | 20 KB | Yes | Yes |
| MyShiftsPage | `/my-shifts` | 6 KB | Yes | Yes |
| AccountPage | `/account` | 5 KB | Yes | Yes |
| LaborForecastPage | `/forecast/labor` | 5 KB | Admin/Mgr | Yes |
| ClinicSettingsPage | `/settings/clinic` | 20 KB | Admin/Mgr | Yes |
| TimesheetsPage | `/timesheets` | 28 KB | Yes | Yes |
| LeavePage | `/leave` | 22 KB | Yes | Yes |
| BillingLedgerPage | `/billing` | 20 KB | Admin/Mgr | Yes |
| AnalyticsDashboardPage | `/analytics` | 9 KB | Admin/Mgr | Yes |
| AuditTrailPage | `/analytics/audit` | 10 KB | Admin/Mgr | Yes |

### Database — 12 Bootstrap Migrations Applied

| Migration ID | Description | Status |
|---|---|---|
| 003_users_schema | Users table with home_clinic_id | Applied |
| 004_rename_clinic_to_home_clinic | Column rename (idempotent) | Applied |
| 005_inventory_schema | Master catalog, stock, adjustments, draft POs | Applied |
| 006_roster_schema | Roster entries + audit trail, shift ENUMs | Applied |
| 007_roster_performance_indexes | Partial indexes for active shift queries | Applied |
| 008_payroll_and_leave_schema | Timesheet entries, leave requests, all payroll ENUMs | Applied |
| 009_user_payroll_track | `payroll_track` column on users | Applied |
| 010_leave_requests_staff_email | `staff_email` denorm on leave_requests | Applied |
| 011_commission_log_state_check | Commission attendance DB-layer constraint | Applied |
| 012_clinics_schema | Canonical clinics table with ABN, timezone, tier | Applied |
| 013_billing_schema | Invoices, line items, payment records, sequences | Applied |
| 014_analytics_audit_schema | audit_events append-only table | Applied |

---

## Part 2 — Partially Completed Modules

### Module 07 — Billing (Session 1 only complete)

**What exists:** Full invoice CRUD, line items, payment records, GST calculation (10% basis points), per-clinic invoice numbering, multi-tenant guards, `BillingLedgerPage.tsx` frontend with `useBilling.ts` hook.

**What is missing:**
- Payment gateway integration (Stripe / Tyro) — webhook handlers not built
- Invoice PDF generation and email dispatch
- Overdue invoice scheduler (status → `overdue` on `due_at` expiry)
- Xero / MYOB accounting adapter (invoice sync + payment reconciliation)

**Evidence:** `billingRoutes.ts` does not include any `/webhook` or `/gateway` paths. No PDF library in `package.json`. No scheduler or cron setup in backend.

### Module 08 — Analytics (Backend Session 1 complete; Frontend built but untested)

**What exists:** Full backend analytics service aggregating KPIs from billing/inventory/roster. Six analytics API endpoints mounted. `AnalyticsDashboardPage.tsx` and `AuditTrailPage.tsx` built. `useAnalyticsDashboard.ts` and `useAuditEvents.ts` hooks present.

**What is missing:**
- Audit event CSV export endpoint
- Cross-clinic aggregate reports for `owner_admin` (all-clinic revenue roll-up)
- No analytics-specific frontend tests written

**Evidence:** No `/export.csv` endpoint in `analyticsRoutes.ts`. No `owner_admin` multi-clinic aggregation in `analyticsService.ts`.

### Module 05 — Payroll / Timesheets / Leave (Backend complete; frontend thin-tested)

**What exists:** Full schema (migration 008+009+010+011), full service implementations for both `timesheetService.ts` (31 KB) and `leaveService.ts` (10 KB), full Postgres repositories, `TimesheetsPage.tsx` (28 KB) and `LeavePage.tsx` (22 KB) with corresponding hooks.

**What is missing:**
- Payroll export adapter (Xero/MYOB/KeyPay/CSV) — Module 09
- Commission log auto-generation hook when roster entry transitions to `completed` (noted as a TODO in project memory but code may implement this in timesheetService)
- Frontend tests for Timesheets and Leave pages

**Evidence:** No `payrollAdapter` or `exportPayroll` function found. `timesheetService.ts` is 31 KB suggesting substantial implementation.

---

## Part 3 — Not Started Modules

| Module | Description | Evidence of Absence |
|--------|-------------|---------------------|
| Module 09 — Payroll Adapter | Xero, MYOB, KeyPay, CSV export adapters | No adapter files in services/, no payroll export routes |
| Module 10 — Supplier Integration | EDI / email dispatch for submitted POs | No supplier email routes or webhook handlers |
| Module 11 — PO Receiving Workflow | Mark PO received, auto-increment stock | No receiving endpoint in purchaseOrderRoutes.ts |
| Module 12 — Patient Management | Patient records, patient-invoice linking | No patient table, invoice.patient_id is UUID with no FK yet |
| Module 13 — PostgreSQL RLS | Row-level security policies | 001_tenant_rls_foundation.sql exists in migrations/ but is NOT in the bootstrap runner |
| Module 14 — Real TOTP MFA | Authenticator app TOTP | MFA bypass still uses dev code `000000`; no TOTP library in package.json |
| Mobile App | React Native iOS/Android | Only placeholder README and config/ in Mobile-app/ |
| Payment Gateway | Stripe / Tyro integration | No gateway SDK in Backend package.json |
| Invoice PDF / Email | PDF generation + dispatch | No PDF library; no email service |
| Overdue Scheduler | Auto-mark invoices overdue | No cron/scheduler infrastructure |
| Cross-Clinic Analytics | Owner-admin aggregate reports | Not in analyticsService.ts |
| Audit Event CSV Export | Export audit trail as CSV | No export route in analyticsRoutes.ts |

---

## Part 4 — Test Suite

### Backend Tests (Evidence from file sizes and grep analysis)

| Test File | Location | Approximate Tests |
|-----------|----------|-------------------|
| payrollPostgresIntegration.test.ts | src/repositories/__tests__/ | 69 |
| payrollRepository.test.ts | tests/ | 36 |
| forecastService.test.ts | tests/ | 29 |
| purchaseOrderApi.test.ts | tests/ | 29 |
| laborForecastService.test.ts | tests/ | 30 |
| billingService.test.ts | tests/ | 28 |
| rosterApi.test.ts | tests/ | 16 |
| scanApi.test.ts | tests/ | 13 |
| csvUtils.test.ts | src/utils/__tests__/ | 15 |
| inventoryApi.test.ts | tests/ | 10 |
| inventoryRepository.test.ts | tests/ | 6 |
| purchaseOrderPostgresIntegration.test.ts | src/repositories/__tests__/ | 17 |
| productApi.test.ts | tests/ | 4 |
| health.test.ts | tests/ | 9 |
| barcodeParser.test.ts | tests/ | 8 |
| purchaseOrderCsvInjection.test.ts | tests/ | 2 |

**Estimated Total Backend Tests: ~321**

> The previous `A_PROJECT_MEMORY.md` documents 278 tests at last commit. New untracked test files (payrollPostgresIntegration, payrollRepository, forecastService, laborForecastService) add approximately 43+ additional tests. The current total is estimated at 320–330. Exact count requires running `npm test`.

### Frontend Tests

| Test File | Tests |
|-----------|-------|
| App.test.tsx | ~1 |
| AddProductPage.test.tsx | 2 |
| InventoryPage.test.tsx | 2 |

**Frontend Total: ~5 tests — critically undertested**

No tests exist for: Roster, Timesheets, Leave, Billing, Analytics, PurchaseOrders, ManageUsers, Account, LaborForecast, ClinicSettings.

---

## Part 5 — Deployment Status

| Item | Status |
|------|--------|
| CI Pipeline | GitHub Actions (`.github/workflows/ci.yml`) — lint, typecheck, test, build on `main` + `dev` |
| Hosting Platform | Targeting Render (`trust proxy 1` set; Render-style env vars referenced) |
| Deployment Configuration | **No `render.yaml`, Procfile, or Railway config found in repo** |
| Environment Variables | `.env.example` present in Backend; `.env.development/.env.production` in Frontend-Web |
| Database | PostgreSQL (production); in-memory fallback (dev without DATABASE_URL) |
| Redis | Optional caching layer via ioredis; graceful fallback if unavailable |
| Dual-mode repositories | All 9 repository modules switch between Postgres and in-memory via single DB probe at startup |
| Staging environment | Not configured |
| Production URL | Not documented |

---

## Part 6 — Technical Debt Register

| ID | Item | Severity | Impact |
|----|------|----------|--------|
| TD-01 | PostgreSQL RLS not applied | **Critical** | Tenant isolation relies solely on application-layer guards; DB-layer safety net missing |
| TD-02 | DEV MFA bypass (`000000`) still present | **High** | Blocked in `NODE_ENV=production` but real TOTP not implemented |
| TD-03 | Frontend test coverage < 5% | **High** | 16 pages; 3 have tests; 13 have zero tests |
| TD-04 | No deployment configuration in repo | **High** | No render.yaml, Procfile, or environment-specific deploy scripts |
| TD-05 | `home_clinic_name` denormalized on users | Medium | Drift risk if clinic is renamed; no cascade update |
| TD-06 | No API rate limiting on non-auth routes | Medium | Auth routes are rate-limited; all other endpoints are not |
| TD-07 | No OpenAPI spec past v0.4.0 | Medium | OpenAPI YAML was at v0.4.0 (scan module); 10+ new modules not documented in OpenAPI |
| TD-08 | No invoice PDF or email | Medium | Billing module incomplete for clinical use without printable invoices |
| TD-09 | Patient ID FK not enforced | Low | `invoices.patient_id` is bare UUID with no patient table yet |
| TD-10 | Mobile app is placeholder only | Low | `Mobile-app/` contains only README + config; no React Native code |
| TD-11 | `schema_migrations` managed by bootstrap runner | Low | No standalone CLI migration tool; migrations run on app startup |
| TD-12 | Refresh tokens stored in-memory | Low | `authService` refresh token store is process-local; multi-instance deploys will fail auth |

---

## Part 7 — Known Blockers

| Blocker | Blocks | Resolution Path |
|---------|--------|-----------------|
| PostgreSQL RLS policies not applied | Production multi-tenant safety | Apply `001_tenant_rls_foundation.sql` + build Module 13 |
| Real TOTP MFA not implemented | Production security compliance | Implement TOTP (e.g. `otplib`) and remove dev bypass |
| Refresh tokens in-memory only | Multi-instance/serverless deployments | Migrate refresh token store to Redis (Redis client already wired) |
| No deployment config file | Any first production deploy | Create `render.yaml` or equivalent |
| No payment gateway | Billing module production use | Integrate Stripe or Tyro |
| No invoice PDF | Clinical billing workflows | Add PDF generation (e.g. PDFKit or Puppeteer) |

---

## Part 8 — Production Readiness Assessment

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Backend API completeness | 75% | All core modules implemented; payment gateway, PDF, accounting adapters, RLS missing |
| Frontend completeness | 72% | 16/16 pages built; analytics/billing pages may have limited data hookup; tests minimal |
| Database schema completeness | 80% | 12 migrations applied; RLS not applied; patient table missing |
| Security hardening | 55% | JWT, RBAC, rate-limiting on auth, CORS done; RLS, TOTP, non-auth rate-limiting missing |
| Test coverage | 60% | Backend well-tested; Frontend nearly untested |
| Deployment readiness | 30% | CI pipeline exists; no deployment config; no documented environment; no staging |
| Mobile app | 2% | Placeholder only |
| **Overall Production Readiness** | **~55%** | Functional for internal use; not ready for external clinic deployment |

---

## Summary Findings

The codebase is substantially more advanced than the project documentation reflects. The gap between `A_PROJECT_MEMORY.md` and the actual repository represents approximately 2–3 full development sessions of undocumented work (Timesheets/Leave full implementation, Analytics frontend, Billing frontend). The core platform is stable and well-architected. The primary remaining work falls into four categories:

1. **Security hardening** (RLS + real TOTP) — required before any external deployment
2. **Billing completeness** (PDF, payment gateway, accounting sync) — required for clinical value
3. **Payroll export adapter** — required for payroll processing
4. **Deployment infrastructure** — required for any production hosting
