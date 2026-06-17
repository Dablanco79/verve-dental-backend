# Next 90 Days Plan — Verve Dental Operational Suite

**Prepared:** June 17, 2026  
**Planning Horizon:** June 17 – September 14, 2026  
**Context:** Post-MVP hardening. Core platform is functionally complete. This plan focuses on the highest-ROI work to reach first real-clinic deployment.

---

## Executive Guidance

The platform is at approximately 55% production readiness. The remaining 45% falls into two distinct categories:

1. **Security and deployment blockers** — Must be resolved before any clinic goes live. No exceptions.
2. **Revenue-enabling features** — These complete the billing, payroll, and analytics workflows that deliver the product's core business value.

The 90-day plan below addresses both categories in a sequenced, dependency-aware order. A single developer working full-time can complete the Top 10 tasks in approximately 8–10 weeks. A two-person team can compress this to 5–6 weeks.

---

## Top 10 Highest ROI Tasks

---

### Task 1 — PostgreSQL Row-Level Security

**Priority:** 1 (Immediate)  
**Business Value:** Critical — without RLS, tenant isolation is entirely application-layer. Any future bug, misconfigured middleware, or direct DB query could expose one clinic's data to another.  
**Complexity:** Medium — schema design is done; policies follow predictable `clinic_id = current_setting(...)` patterns  
**Risk if skipped:** Catastrophic — data breach between dental practices; regulatory and legal exposure  
**Effort:** 2–3 days

**What to build:**
- Apply `migrations/001_tenant_rls_foundation.sql` and integrate it into the bootstrap runner
- Add `SET app.user.clinic_id = '...'` to the DB pool's query context before every query
- Write RLS policies for all 12+ tenant-scoped tables
- Integration test: verify that a Clinic B query returns zero results for Clinic A credentials

**Acceptance criteria:** Cross-tenant data is not accessible even via raw SQL on the connected pool.

---

### Task 2 — Refresh Token Redis Persistence

**Priority:** 2 (Immediate)  
**Business Value:** High — prevents all users being logged out on every server restart; required for any multi-instance deployment (Render auto-scaling)  
**Complexity:** Low — Redis client is already wired and gracefully available  
**Risk if skipped:** Every deploy or scale event logs out every user; unacceptable for a live clinic  
**Effort:** 1 day

**What to build:**
- Move refresh token store from in-memory `Map` to Redis with TTL = 7 days
- Update `storeRefreshToken`, `validateRefreshToken`, `revokeRefreshToken`, `revokeAllUserTokens` in `authService.ts`
- Graceful fallback to in-memory if Redis is unavailable (already established pattern)

**Acceptance criteria:** Restart the backend server; existing refresh tokens still work.

---

### Task 3 — Deployment Configuration (`render.yaml`)

**Priority:** 3 (Immediate)  
**Business Value:** High — no deployment can happen without this; blocks the entire go-live path  
**Complexity:** Low — well-understood platform; config is straightforward  
**Risk if skipped:** First deployment requires manual configuration every time; no reproducibility  
**Effort:** 0.5 days

**What to build:**
- `render.yaml` defining: Backend web service, PostgreSQL managed DB, Redis managed instance, health check at `/health`, environment variable references
- Update README with deployment instructions
- Confirm `Frontend-Web/.env.production` has correct `VITE_API_BASE_URL`

**Acceptance criteria:** `git push` triggers a Render deploy that passes health check.

---

### Task 4 — Real TOTP Multi-Factor Authentication

**Priority:** 4 (Before first clinic login)  
**Business Value:** High — privileged roles (owner_admin, group_practice_manager) access financial, payroll, and patient data; SMS/TOTP MFA is a compliance requirement for healthcare SaaS  
**Complexity:** Medium — auth flow changes; frontend enrollment UX required  
**Risk if skipped:** Regulatory non-compliance; password-only authentication insufficient for financial SaaS  
**Effort:** 2–3 days

**What to build:**
- Add `otplib` to Backend dependencies
- Migration: add `totp_secret` and `totp_enrolled_at` columns to `users`
- `POST /auth/mfa/setup` — generate TOTP secret, return QR code data URL
- `POST /auth/mfa/confirm-setup` — confirm enrollment with first valid code
- Update `POST /auth/mfa/verify` to validate TOTP code via `otplib`
- Remove the `DEV_MFA_CODE = '000000'` bypass from all paths except `NODE_ENV=test`
- Frontend: MFA enrollment page (show QR code, confirm first code)
- Frontend: Update `LoginPage` MFA step to accept 6-digit TOTP

**Acceptance criteria:** `owner_admin` accounts cannot access privileged routes without enrolled TOTP.

---

### Task 5 — Invoice PDF Generation

**Priority:** 5 (First billing cycle)  
**Business Value:** Very High — clinics cannot send invoices to patients without a printable/emailable document; this is the core of the billing module's clinical utility  
**Complexity:** Medium — PDF layout work is the main effort  
**Risk if skipped:** Billing module has no clinical value without printable invoices; clinics will not adopt  
**Effort:** 2 days

**What to build:**
- Add `pdfkit` to Backend dependencies (no binary deps; pure JS)
- `GET /clinics/:id/billing/invoices/:invoiceId/pdf` — streams `application/pdf`
- PDF template: clinic name + ABN, patient name, invoice number, issue date, due date, line item table (description, qty, unit price, GST, total), subtotal/GST/total summary, payment received, amount outstanding, payment instructions footer
- Add RBAC: any authenticated user in the clinic can download their invoice PDF
- Frontend: "Download PDF" button on BillingLedgerPage for issued invoices
- `downloadInvoicePdf(clinicId, invoiceId)` in `api/client.ts` (blob URL pattern)

**Acceptance criteria:** Issued invoice generates a valid, correctly-populated PDF on download.

---

### Task 6 — Overdue Invoice Scheduler

**Priority:** 6 (Billing completeness)  
**Business Value:** High — invoices that pass `due_at` currently stay in `issued` or `partially_paid` status forever; overdue tracking is essential for accounts receivable management  
**Complexity:** Low — service logic is a simple query; scheduling is one `setInterval`  
**Risk if skipped:** Accounts receivable data is inaccurate; overdue reporting impossible  
**Effort:** 1 day

**What to build:**
- `BillingService.markOverdueInvoices(clinicId?)` — transitions `issued`/`partially_paid` invoices with `due_at < now()` to `overdue`; runs cross-clinic for owner_admin
- Run on a 1-hour interval from `src/index.ts` startup
- Log each batch to Pino with count of invoices transitioned
- Frontend: `overdue` status badge (red) on BillingLedgerPage
- Dashboard KPI: include overdue invoice count in analytics dashboard

**Acceptance criteria:** An invoice with `due_at` in the past automatically transitions to `overdue` within 1 hour.

---

### Task 7 — Payroll Export (CSV)

**Priority:** 7 (Payroll cycle)  
**Business Value:** Very High — timesheets are fully approved but unprocessable; clinics cannot run payroll without an export; this completes the end-to-end payroll workflow  
**Complexity:** Low–Medium — CSV format; Xero adapter is more complex  
**Risk if skipped:** The entire timesheet/leave module delivers no operational value without export  
**Effort:** 1.5 days (CSV); 3 days additional for Xero Payroll adapter

**What to build:**
- `GET /clinics/:id/timesheets/export.csv` — approved hourly entries in date range
- Columns: staff_name, staff_email, shift_date, payroll_type, ordinary_hours, overtime_1_5x_hours, overtime_2x_hours, total_hours, approval_status
- `?from=&to=` date range filter; default: current pay period (2 weeks)
- RFC 4180 CSV with double-quote escaping (same pattern as PO export)
- Frontend: "Export Payroll CSV" button on TimesheetsPage
- RBAC: owner_admin + group_practice_manager only

**Acceptance criteria:** Manager downloads CSV containing all approved entries for the period; can import into MYOB/Xero manually.

---

### Task 8 — Frontend Test Coverage Expansion

**Priority:** 8 (Ongoing quality)  
**Business Value:** High — 13 of 16 pages have zero tests; any regression in billing, timesheets, or leave goes undetected; slows all future development  
**Complexity:** Low–Medium — patterns are established from existing tests  
**Risk if skipped:** Increases cost of all future changes; will eventually produce a production regression  
**Effort:** 3–4 days

**What to build:**
- Establish a `vi.mock('../api/client')` helper pattern in `Frontend-Web/tests/helpers/`
- Write tests for (priority order): `BillingLedgerPage`, `TimesheetsPage`, `LeavePage`, `RosterCalendarPage`, `ManageUsersPage`, `AnalyticsDashboardPage`, `AuditTrailPage`, `PurchaseOrdersPage`, `ClinicSettingsPage`, `LaborForecastPage`, `AccountPage`, `MyShiftsPage`, `HomePage`
- Minimum per page: renders without crashing, RBAC redirect for unauthorized role
- Target: 60+ frontend tests (from current ~5)
- Add frontend test run to CI pipeline as a blocking step

**Acceptance criteria:** `npm test` in `Frontend-Web` produces 60+ passing tests with 0 failures.

---

### Task 9 — Materials Forecast Frontend Page

**Priority:** 9 (Feature completeness)  
**Business Value:** Medium–High — `forecastService.ts` is one of the most sophisticated backend modules but has no UI; clinic managers cannot see inventory replenishment forecasts  
**Complexity:** Low — backend is complete; this is purely frontend work following established patterns  
**Risk if skipped:** A major differentiating feature remains invisible; reduces product value proposition  
**Effort:** 1.5 days

**What to build:**
- `MaterialsForecastPage.tsx` at `/forecast/materials`
- Fetch from `GET /clinics/:id/forecast/materials` (existing endpoint)
- Table: item name, SKU, current stock, average daily consumption, days remaining, reorder point
- Colour coding: red (< 7 days), amber (7–14 days), green (14+ days)
- `useMaterialsForecast.ts` hook with `forecastDays` parameter (default: 30)
- Nav link: "Materials Forecast" for managers/admins
- Empty state: "No consumption data for selected period"

**Acceptance criteria:** Page loads, displays accurate forecast data, and colour-codes items by days-remaining severity.

---

### Task 10 — Cross-Clinic Analytics (Owner Admin Dashboard)

**Priority:** 10 (Multi-clinic value)  
**Business Value:** Medium — `owner_admin` role is the primary buyer/decision-maker; they currently have the same per-clinic view as a single-clinic manager; cross-clinic visibility is the key differentiator for group practices  
**Complexity:** Medium — requires new backend aggregation logic; frontend dashboard restructure  
**Risk if skipped:** Owner-admin value proposition is not realized; limits appeal to group practices (the most valuable customer segment)  
**Effort:** 2 days

**What to build:**
- `GET /analytics/owner/dashboard` (no clinicId) — aggregate KPIs across all clinics (requires owner_admin role)
- Response: per-clinic revenue, invoice counts, low-stock alerts, roster coverage for next 7 days
- `analyticsService.getOwnerDashboard(ownerId)` — fans out to all clinics the owner manages
- Frontend: new `OwnerDashboardPage.tsx` at `/owner/dashboard` (only rendered for owner_admin)
- Clinic selector on existing per-clinic analytics page for owner_admin
- Navigate to per-clinic detail from owner dashboard cards

**Acceptance criteria:** Owner-admin sees aggregate KPIs for all their clinics; can drill into a specific clinic's analytics from the dashboard.

---

## 90-Day Execution Timeline

### Weeks 1–2 (June 17 – June 30): Security Sprint

| Week | Tasks | Outcome |
|------|-------|---------|
| Week 1 | Task 1 (RLS), Task 2 (Redis tokens) | Tenant isolation hardened; session persistence fixed |
| Week 2 | Task 3 (Deploy config), Task 4 (TOTP MFA) | Deployable platform with real MFA |

**Milestone:** Platform is deployable to staging and safe for privileged user access.

---

### Weeks 3–4 (July 1 – July 14): Billing Sprint

| Week | Tasks | Outcome |
|------|-------|---------|
| Week 3 | Task 5 (Invoice PDF), Task 6 (Overdue scheduler) | Clinically usable billing module |
| Week 4 | Task 7 (Payroll CSV export), Task 8 (start frontend tests) | Payroll workflow complete; test foundation started |

**Milestone:** First pilot clinic can create, issue, and export invoices; managers can export payroll.

---

### Weeks 5–6 (July 15 – July 28): Quality & Feature Sprint

| Week | Tasks | Outcome |
|------|-------|---------|
| Week 5 | Task 8 (complete frontend tests), Task 9 (Materials forecast page) | 60+ frontend tests; materials forecast visible |
| Week 6 | Task 10 (Cross-clinic analytics), B3 (Forecast alerts) | Owner-admin value proposition complete |

**Milestone:** Platform ready for first group practice (multi-clinic) pilot deployment.

---

### Weeks 7–13 (July 29 – September 14): Integration Sprint

| Week | Focus | Notes |
|------|-------|-------|
| Weeks 7–8 | Stripe payment gateway (Phase C3) | Revenue-critical; most complex remaining item |
| Weeks 9–10 | Xero accounting adapter — invoices (Phase C4) | Australian accountants demand Xero |
| Weeks 11–12 | Xero Payroll adapter (Phase E1 extension) | Completes payroll export for Xero users |
| Week 13 | PO receiving workflow (Phase E2), supplier email (Phase E6) | Completes procurement loop |

**Milestone:** Full operational loop: patient visit → invoice → payment (Stripe) → sync (Xero) → payroll export (Xero Payroll) → inventory reorder (PO email to supplier).

---

## Priority Matrix

| Task | Priority Rank | Business Value | Complexity | Risk (if skipped) |
|------|--------------|---------------|------------|-------------------|
| PostgreSQL RLS | 1 | Critical | Medium | Catastrophic |
| Redis token persistence | 2 | High | Low | High |
| Deployment config | 3 | High | Low | High |
| Real TOTP MFA | 4 | High | Medium | High |
| Invoice PDF | 5 | Very High | Medium | High |
| Overdue invoice scheduler | 6 | High | Low | Medium |
| Payroll CSV export | 7 | Very High | Low–Medium | High |
| Frontend test coverage | 8 | High | Low–Medium | Medium |
| Materials forecast page | 9 | Medium–High | Low | Low |
| Cross-clinic analytics | 10 | Medium | Medium | Medium |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| RLS policy mistakes cause correct-clinic queries to return empty | Medium | High | Test each policy in isolation; use `SET` session variable in test harness |
| Stripe integration delayed by bank/merchant account setup | High | Medium | Begin Stripe test-mode integration first; real account setup runs in parallel |
| Xero OAuth approval process (partner program) takes weeks | High | Medium | Begin Xero developer application immediately; this has external lead time |
| Frontend test writing underestimated | Medium | Low | Use established mock patterns; prioritise happy-path and RBAC tests only |
| TOTP enrollment UX friction causes user complaints | Medium | Low | Offer enrolment at first login; don't force immediate rollout |

---

## Success Metrics at 90 Days

| Metric | Target |
|--------|--------|
| Backend tests | 400+ passing |
| Frontend tests | 60+ passing |
| TypeScript errors | 0 in both workspaces |
| Production readiness | 85%+ |
| RLS applied | Yes |
| Real TOTP active | Yes |
| Deployed to Render staging | Yes |
| First pilot clinic onboarded | Yes |
| Invoice PDF functional | Yes |
| Payroll export functional | Yes |
