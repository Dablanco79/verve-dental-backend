# Dependency Map V2 — Verve Dental Operational Suite

**Prepared:** June 17, 2026  
**Supersedes:** Previous DEPENDENCY_MAP.md  
**Reflects:** Actual repository state as of June 17, 2026  
**Legend:**  
- `COMPLETE` — fully implemented, routed, tested, and in use  
- `COMPLETE (partial)` — primary implementation done; secondary features pending  
- `IN PROGRESS` — implementation started but not finished  
- `NOT STARTED` — no code exists beyond scaffolding  

---

## Section 1 — Backend Modules

### 1.1 Core Infrastructure

| Module | Status | Evidence |
|--------|--------|---------|
| Express app scaffold | COMPLETE | `src/app.ts`, `src/index.ts` |
| TypeScript + ESM config | COMPLETE | `tsconfig.json`, `tsconfig.build.json` |
| Dependency injection container | COMPLETE | `src/bootstrap/dependencies.ts` |
| Dual-mode repo bootstrap | COMPLETE | DB probe in `createAppDependencies()` |
| Environment config | COMPLETE | `src/config/index.ts` |
| Error handler | COMPLETE | `src/middleware/errorHandler.ts` |
| Async handler utility | COMPLETE | `src/utils/asyncHandler.ts` |
| Pino structured logging | COMPLETE | `src/utils/logger.ts` |
| Helmet security headers | COMPLETE | Applied in `app.ts` |
| CORS restriction | COMPLETE | `src/utils/cors.ts`, `CORS_ORIGIN` env var |
| Trust proxy (Render) | COMPLETE | `app.set('trust proxy', 1)` |
| Health endpoint | COMPLETE | `GET /health` |
| CI pipeline | COMPLETE | `.github/workflows/ci.yml` |

### 1.2 Authentication & Security

| Module | Status | Evidence |
|--------|--------|---------|
| JWT access tokens (15m) | COMPLETE | `src/services/authService.ts` |
| JWT refresh tokens (7d) | COMPLETE | `authService.ts` |
| Refresh token persistence | **NOT STARTED** | Tokens stored in-memory Map only |
| bcrypt password hashing | COMPLETE | `authService.ts` |
| RBAC middleware | COMPLETE | `src/middleware/authMiddleware.ts` |
| Tenant enforcement middleware | COMPLETE | `enforceTenantParam` in `authMiddleware.ts` |
| Auth rate limiting | COMPLETE | `express-rate-limit` on `/auth/*` |
| Data route rate limiting | **NOT STARTED** | No limiter on inventory/billing/roster |
| Dev MFA bypass (`000000`) | COMPLETE (partial) | Works in dev; blocked in production |
| Real TOTP MFA | **NOT STARTED** | No TOTP library; no `totp_secret` column |
| Structured auth audit logging | COMPLETE | Pino + `auditService` |
| Password change / admin reset | COMPLETE | `/auth/change-password`, `/users/:id/reset-password` |

### 1.3 User Management

| Module | Status | Evidence |
|--------|--------|---------|
| `UserRepository` interface | COMPLETE | `src/repositories/userRepository.ts` |
| In-memory user repository | COMPLETE | `userRepository.ts` |
| Postgres user repository | COMPLETE | `userRepository.postgres.ts` |
| `UserService` | COMPLETE | `src/services/userService.ts` |
| User CRUD API | COMPLETE | `src/routes/userRoutes.ts` |
| User seed data | COMPLETE | `src/db/seed.ts` → `seedDemoUsers()` |

### 1.4 Clinic Management

| Module | Status | Evidence |
|--------|--------|---------|
| `ClinicRepository` interface | COMPLETE | `src/repositories/clinicRepository.ts` |
| In-memory clinic repository | COMPLETE | `clinicRepository.ts` |
| Postgres clinic repository | COMPLETE | `clinicRepository.postgres.ts` |
| `ClinicService` | COMPLETE | `src/services/clinicService.ts` |
| Clinic settings API | COMPLETE | `src/routes/clinicRoutes.ts` |
| `012_clinics_schema` migration | COMPLETE | Applied in bootstrap runner |
| Xero tenant ID on clinics | **NOT STARTED** | Column not in schema |

### 1.5 Inventory

| Module | Status | Evidence |
|--------|--------|---------|
| `CatalogRepository` interface | COMPLETE | `src/repositories/catalogRepository.ts` |
| In-memory catalog repository | COMPLETE | `catalogRepository.ts` |
| Postgres catalog repository | COMPLETE | `catalogRepository.postgres.ts` |
| `InventoryRepository` interface | COMPLETE | `src/repositories/inventoryRepository.ts` |
| In-memory inventory repository | COMPLETE | `inventoryRepository.ts` |
| Postgres inventory repository | COMPLETE | `inventoryRepository.postgres.ts` |
| `getConsumptionVolume()` method | COMPLETE | Both implementations (hardening pass) |
| `InventoryService` | COMPLETE | `src/services/inventoryService.ts` |
| Inventory API | COMPLETE | `src/routes/inventoryRoutes.ts` |
| `005_inventory_schema` migration | COMPLETE | Applied in bootstrap runner |
| Inventory seed data | COMPLETE | `src/db/seed.ts` → `seedInventory()` |

### 1.6 Barcode Scanning & Purchase Orders

| Module | Status | Evidence |
|--------|--------|---------|
| Barcode parser utility | COMPLETE | `src/utils/barcodeParser.ts` |
| `ScanService` | COMPLETE | `src/services/scanService.ts` |
| Scan API | COMPLETE | `src/routes/scanRoutes.ts` |
| `ProductService` | COMPLETE | `src/services/productService.ts` |
| Product API | COMPLETE | `src/routes/productRoutes.ts` |
| `PurchaseOrderService` | COMPLETE | `src/services/purchaseOrderService.ts` |
| PO list + submit + CSV export | COMPLETE | `src/routes/purchaseOrderRoutes.ts` |
| PO receiving workflow | **NOT STARTED** | No `receive` endpoint |
| Supplier email / EDI | **NOT STARTED** | No email service; no suppliers table |

### 1.7 Roster & Scheduling

| Module | Status | Evidence |
|--------|--------|---------|
| `RosterRepository` interface | COMPLETE | `src/repositories/rosterRepository.ts` |
| In-memory roster repository | COMPLETE | `rosterRepository.ts` |
| Postgres roster repository | COMPLETE | `rosterRepository.postgres.ts` |
| `RosterService` | COMPLETE | `src/services/rosterService.ts` |
| Roster API | COMPLETE | `src/routes/rosterRoutes.ts` |
| `006_roster_schema` migration | COMPLETE | Applied in bootstrap runner |
| `007_roster_performance_indexes` | COMPLETE | Applied in bootstrap runner |
| Cross-clinic access logic | COMPLETE | `hasActiveShiftAtClinic()` in rosterService |

### 1.8 Forecasting

| Module | Status | Evidence |
|--------|--------|---------|
| `ForecastService` (materials) | COMPLETE | `src/services/forecastService.ts` |
| Materials forecast API | COMPLETE | `src/routes/forecastRoutes.ts` |
| `LaborForecastService` | COMPLETE | `src/services/laborForecastService.ts` |
| Labor forecast API | COMPLETE | `src/routes/laborForecastRoutes.ts` |
| Timezone-safe date arithmetic | COMPLETE | Helpers in both forecast services |
| Integer cents for labor costs | COMPLETE | Hardening pass complete |
| Forecast alerts endpoint | **NOT STARTED** | `/forecast/alerts` path not implemented |

### 1.9 Timesheets & Leave (Module 05)

| Module | Status | Evidence |
|--------|--------|---------|
| `TimesheetRepository` interface | COMPLETE | `src/repositories/timesheetRepository.ts` |
| In-memory timesheet repository | COMPLETE | `timesheetRepository.ts` |
| Postgres timesheet repository | COMPLETE | `timesheetRepository.postgres.ts` |
| `LeaveRepository` interface | COMPLETE | `src/repositories/leaveRepository.ts` |
| In-memory leave repository | COMPLETE | `leaveRepository.ts` |
| Postgres leave repository | COMPLETE | `leaveRepository.postgres.ts` |
| `TimesheetService` | COMPLETE | `src/services/timesheetService.ts` (31 KB) |
| `LeaveService` | COMPLETE | `src/services/leaveService.ts` |
| Timesheet API | COMPLETE | `src/routes/payrollRoutes.ts` |
| Leave API | COMPLETE | `src/routes/payrollRoutes.ts` |
| `008_payroll_and_leave_schema` | COMPLETE | Applied in bootstrap runner |
| `009_user_payroll_track` | COMPLETE | Applied in bootstrap runner |
| `010_leave_requests_staff_email` | COMPLETE | Applied in bootstrap runner |
| `011_commission_log_state_check` | COMPLETE | Applied in bootstrap runner |
| Payroll export adapter (CSV) | **NOT STARTED** | No export endpoint |
| Payroll export adapter (Xero) | **NOT STARTED** | No Xero SDK |
| Payroll export adapter (MYOB) | **NOT STARTED** | No MYOB SDK |
| Commission log auto-generation | COMPLETE (partial) | Wired via rosterService → timesheetService |

### 1.10 Billing & Invoicing (Module 07)

| Module | Status | Evidence |
|--------|--------|---------|
| `BillingRepository` interface | COMPLETE | `src/repositories/billingRepository.ts` |
| In-memory billing repository | COMPLETE | `billingRepository.ts` |
| Postgres billing repository | COMPLETE | `billingRepository.postgres.ts` |
| `BillingService` | COMPLETE | `src/services/billingService.ts` (21 KB) |
| Billing API (full invoice lifecycle) | COMPLETE | `src/routes/billingRoutes.ts` |
| `013_billing_schema` migration | COMPLETE | Applied in bootstrap runner |
| GST calculation (basis points) | COMPLETE | `calculateTaxCents()` in types/billing.ts |
| Multi-tenant billing guard | COMPLETE | `assertTenantAccess()` in billingService |
| Invoice PDF generation | **NOT STARTED** | No PDF library in package.json |
| Invoice email dispatch | **NOT STARTED** | No email service |
| Overdue invoice scheduler | **NOT STARTED** | No cron/setInterval |
| Stripe payment gateway | **NOT STARTED** | No stripe SDK |
| Tyro payment gateway | **NOT STARTED** | No tyro SDK |
| Xero invoice sync | **NOT STARTED** | No Xero OAuth |
| MYOB invoice sync | **NOT STARTED** | No MYOB SDK |

### 1.11 Analytics & Audit Trail (Module 08)

| Module | Status | Evidence |
|--------|--------|---------|
| `AnalyticsRepository` interface | COMPLETE | `src/repositories/analyticsRepository.ts` |
| In-memory analytics repository | COMPLETE | `analyticsRepository.ts` (12 pre-seeded events) |
| Postgres analytics repository | COMPLETE | `analyticsRepository.postgres.ts` |
| `AnalyticsService` | COMPLETE | `src/services/analyticsService.ts` (15 KB) |
| Analytics API (6 endpoints) | COMPLETE | `src/routes/analyticsRoutes.ts` |
| `014_analytics_audit_schema` | COMPLETE | Applied in bootstrap runner |
| Audit event wiring (billing) | COMPLETE | billingService → analyticsRepository |
| Audit event wiring (roster) | COMPLETE | rosterService → analyticsRepository |
| Audit event wiring (inventory) | COMPLETE | inventoryService → analyticsRepository |
| Audit event CSV export | **NOT STARTED** | No export endpoint |
| Cross-clinic aggregate reports | **NOT STARTED** | Single-clinic analytics only |
| Cross-clinic owner dashboard | **NOT STARTED** | No owner-level aggregation endpoint |

### 1.12 Database Infrastructure

| Module | Status | Evidence |
|--------|--------|---------|
| PostgreSQL connection pool | COMPLETE | `src/db/pool.ts` |
| Bootstrap migration runner | COMPLETE | `src/db/migrate.ts` (advisory lock) |
| `schema_migrations` tracking table | COMPLETE | Created by bootstrap runner |
| Advisory lock on migrations | COMPLETE | `pg_advisory_xact_lock()` |
| Migration CLI tool | **NOT STARTED** | No standalone CLI script |
| PostgreSQL RLS | **NOT STARTED** | `001_tenant_rls_foundation.sql` exists but not applied |
| `001_tenant_rls_foundation.sql` | NOT STARTED | In migrations/ but not bootstrapped |

### 1.13 Infrastructure Services

| Module | Status | Evidence |
|--------|--------|---------|
| Redis client (ioredis) | COMPLETE | `src/redis/client.ts` |
| Redis graceful fallback | COMPLETE | ECONNREFUSED swallowed in bootstrap |
| Refresh token Redis store | **NOT STARTED** | Tokens in-memory only |
| Background job scheduler | **NOT STARTED** | No cron/queue infrastructure |
| Email service | **NOT STARTED** | No email provider configured |
| File storage | **NOT STARTED** | No S3 or file upload configured |

---

## Section 2 — Frontend Modules

### 2.1 Application Shell

| Module | Status | Evidence |
|--------|--------|---------|
| React 19 + Vite 6 scaffold | COMPLETE | `Frontend-Web/package.json` |
| TypeScript strict config | COMPLETE | `tsconfig.app.json` |
| React Router 7 | COMPLETE | `src/App.tsx` — 16 routes |
| `AuthContext` + `ProtectedRoute` | COMPLETE | `src/auth/` |
| `AppShell` navigation | COMPLETE | `src/components/layout/AppShell.tsx` |
| Role-gated nav links | COMPLETE | Uses `canManageUsers()`, `canViewLaborForecast()`, etc. |
| API client (`client.ts`) | COMPLETE | `src/api/client.ts` (22 KB) — all endpoints covered |
| Role utilities (`roles.ts`) | COMPLETE | `src/utils/roles.ts` |
| Global CSS (`index.css`) | COMPLETE | 52 KB — all module styles included |

### 2.2 Auth Pages

| Module | Status | Evidence |
|--------|--------|---------|
| Login page | COMPLETE | `LoginPage.tsx` |
| MFA verification step | COMPLETE | Built into LoginPage flow |
| TOTP enrollment flow | **NOT STARTED** | Real TOTP not implemented |
| Account page (change password) | COMPLETE | `AccountPage.tsx` |

### 2.3 Inventory & Scanning

| Module | Status | Evidence |
|--------|--------|---------|
| Inventory page (stock table) | COMPLETE | `InventoryPage.tsx` |
| Scan form (manual barcode) | COMPLETE | `ScanForm` in `InventoryPage.tsx` |
| Add product page | COMPLETE | `AddProductPage.tsx` |
| Purchase orders page | COMPLETE | `PurchaseOrdersPage.tsx` |
| PO submit workflow | COMPLETE | Submit button + batch submit |
| PO CSV export | COMPLETE | "Export CSV" button |
| PO receiving UI | **NOT STARTED** | No receiving workflow in UI |
| Materials forecast page | **NOT STARTED** | No `MaterialsForecastPage.tsx` |
| Forecast alerts badge | **NOT STARTED** | No alerts UI |

### 2.4 Roster & Scheduling

| Module | Status | Evidence |
|--------|--------|---------|
| Roster calendar page | COMPLETE | `RosterCalendarPage.tsx` (20 KB) |
| Weekly grid with shift cards | COMPLETE | Colour-coded by type/status |
| Create/edit shift modal | COMPLETE | Built into RosterCalendarPage |
| My shifts page | COMPLETE | `MyShiftsPage.tsx` |
| Cross-clinic indicator | COMPLETE | In MyShiftsPage |

### 2.5 Timesheets & Leave

| Module | Status | Evidence |
|--------|--------|---------|
| Timesheets page | COMPLETE | `TimesheetsPage.tsx` (28 KB) |
| Leave page | COMPLETE | `LeavePage.tsx` (22 KB) |
| `useTimesheets` hook | COMPLETE | `src/hooks/useTimesheets.ts` |
| `useLeave` hook | COMPLETE | `src/hooks/useLeave.ts` |
| Commission attendance verification UI | **IN PROGRESS** | Panel exists in TimesheetsPage but verification is limited |

### 2.6 Forecasting

| Module | Status | Evidence |
|--------|--------|---------|
| Labor forecast page | COMPLETE | `LaborForecastPage.tsx` |
| `LaborForecastSummaryCard` | COMPLETE | `src/components/forecast/` |
| `LaborForecastTable` | COMPLETE | `src/components/forecast/` |
| `useLaborForecast` hook | COMPLETE | `src/hooks/useLaborForecast.ts` |
| Materials forecast page | **NOT STARTED** | Not in pages/ or App.tsx |

### 2.7 Billing

| Module | Status | Evidence |
|--------|--------|---------|
| Billing ledger page | COMPLETE | `BillingLedgerPage.tsx` (20 KB) |
| `useBilling` hook | COMPLETE | `src/hooks/useBilling.ts` |
| Invoice PDF download | **NOT STARTED** | No PDF endpoint |
| Stripe checkout integration | **NOT STARTED** | No Stripe SDK |
| Xero sync UI | **NOT STARTED** | No Xero OAuth UI |

### 2.8 Analytics & Audit

| Module | Status | Evidence |
|--------|--------|---------|
| Analytics dashboard page | COMPLETE | `AnalyticsDashboardPage.tsx` |
| `useAnalyticsDashboard` hook | COMPLETE | `src/hooks/useAnalyticsDashboard.ts` |
| Audit trail page | COMPLETE | `AuditTrailPage.tsx` |
| `useAuditEvents` hook | COMPLETE | `src/hooks/useAuditEvents.ts` |
| Audit CSV export | **NOT STARTED** | No export button/endpoint |
| Cross-clinic dashboard | **NOT STARTED** | No owner-admin aggregate view |

### 2.9 Clinic & User Management

| Module | Status | Evidence |
|--------|--------|---------|
| Manage users page | COMPLETE | `ManageUsersPage.tsx` |
| Password reset (admin) | COMPLETE | Inline form on ManageUsersPage |
| Clinic settings page | COMPLETE | `ClinicSettingsPage.tsx` |
| TOTP enrollment page | **NOT STARTED** | Not in App.tsx routes |

### 2.10 Frontend Testing

| Module | Status | Evidence |
|--------|--------|---------|
| Vitest setup | COMPLETE | `vitest.config.ts`, `tests/setup.ts` |
| `App.test.tsx` | COMPLETE | Smoke test |
| `AddProductPage.test.tsx` | COMPLETE | 2 tests |
| `InventoryPage.test.tsx` | COMPLETE | 2 tests |
| RosterCalendarPage tests | **NOT STARTED** | No test file |
| TimesheetsPage tests | **NOT STARTED** | No test file |
| LeavePage tests | **NOT STARTED** | No test file |
| BillingLedgerPage tests | **NOT STARTED** | No test file |
| AnalyticsDashboardPage tests | **NOT STARTED** | No test file |
| All other 9 pages | **NOT STARTED** | No test files |

---

## Section 3 — Database Schema

| Table | Migration | FK References | Status |
|-------|-----------|--------------|--------|
| `schema_migrations` | (runtime) | — | COMPLETE |
| `users` | 003 + 004 + 009 | — | COMPLETE |
| `master_catalog_items` | 005 | — | COMPLETE |
| `barcode_mappings` | 005 | master_catalog_items | COMPLETE |
| `clinic_inventory_items` | 005 | master_catalog_items | COMPLETE |
| `inventory_adjustments` | 005 | clinic_inventory_items, master_catalog_items | COMPLETE |
| `draft_purchase_orders` | 005 | — | COMPLETE |
| `draft_po_lines` | 005 | draft_purchase_orders, master_catalog_items, clinic_inventory_items | COMPLETE |
| `roster_entries` | 006 | users | COMPLETE |
| `roster_entry_audit` | 006 | roster_entries | COMPLETE |
| `timesheet_entries` | 008 + 011 | users, roster_entries | COMPLETE |
| `leave_requests` | 008 + 010 | users | COMPLETE |
| `clinics` | 012 | — | COMPLETE |
| `invoices` | 013 | clinics, users | COMPLETE |
| `invoice_number_sequences` | 013 | clinics | COMPLETE |
| `invoice_line_items` | 013 | invoices | COMPLETE |
| `payment_records` | 013 | invoices, users | COMPLETE |
| `audit_events` | 014 | — (clinic_id bare UUID) | COMPLETE |
| `patients` | NOT STARTED | — | NOT STARTED |
| `suppliers` | NOT STARTED | — | NOT STARTED |
| RLS policies | NOT STARTED | All tenant tables | NOT STARTED |

---

## Section 4 — Mobile App

| Module | Status | Evidence |
|--------|--------|---------|
| React Native scaffold | NOT STARTED | `Mobile-app/` contains README + config/ only |
| Barcode scan screen | NOT STARTED | — |
| My shifts screen | NOT STARTED | — |
| Login screen | NOT STARTED | — |
| Push notifications | NOT STARTED | — |

---

## Section 5 — Infrastructure & Deployment

| Module | Status | Evidence |
|--------|--------|---------|
| GitHub Actions CI | COMPLETE | `.github/workflows/ci.yml` |
| `render.yaml` | **NOT STARTED** | File not present |
| Staging environment | **NOT STARTED** | Not configured |
| Production environment | **NOT STARTED** | Not configured |
| Database backups | NOT STARTED | No backup strategy documented |
| Monitoring / alerting | NOT STARTED | No APM, error tracking configured |
| Secrets management | Partial | `.env.example` present; no vault or secrets manager |

---

## Summary Counts

| Category | COMPLETE | COMPLETE (partial) | IN PROGRESS | NOT STARTED |
|----------|----------|---------------------|-------------|-------------|
| Backend Core Infrastructure | 13 | 0 | 0 | 0 |
| Authentication & Security | 9 | 1 | 0 | 3 |
| Backend Services | 15 | 2 | 0 | 7 |
| Backend Repositories | 9 pairs | 0 | 0 | 2 |
| Backend Routes | 14 | 0 | 0 | 5 |
| Database Migrations | 12 | 0 | 0 | 3 |
| Frontend Pages | 16 | 0 | 0 | 0 |
| Frontend Hooks | 6 | 0 | 0 | 0 |
| Frontend Tests | 3 | 0 | 0 | 13 |
| Infrastructure/Deployment | 1 | 1 | 0 | 6 |
| Mobile App | 0 | 0 | 0 | 5 |
