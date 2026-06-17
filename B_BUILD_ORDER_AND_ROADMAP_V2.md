# Build Order and Roadmap V2 — Verve Dental Operational Suite

**Prepared:** June 17, 2026  
**Supersedes:** Previous BUILD_ORDER.md  
**Reflects:** Actual repository state as of June 17, 2026  
**Note:** All work completed prior to this document's date has been removed from this roadmap. This document begins from the current state and describes only remaining work.

---

## Current State Summary

The following major modules are **complete** and excluded from this roadmap:

- Core platform scaffold (monorepo, CI, TypeScript configs)
- JWT authentication, RBAC, tenant middleware
- Inventory, scanning, barcode parsing
- Purchase orders (draft, submit, CSV export)
- Roster scheduling (backend + frontend calendar)
- Materials forecasting (timezone-safe, SQL predicate push-down)
- Labor cost forecasting (integer cents, clinic timezone)
- Timesheets and leave management (full backend + frontend)
- Billing and invoicing (Session 1 — full CRUD lifecycle)
- Analytics and audit trail (Session 1 — KPI + audit events)
- Clinic settings management
- User management and password reset
- All 12 database bootstrap migrations
- All 16 frontend pages routed and implemented
- GitHub Actions CI pipeline

---

## Phase A — MVP Completion (Security + Deployment Hardening)

**Objective:** Make the platform safe and deployable for the first real clinic pilot. Nothing should go to production without this phase complete.

**Target Timeframe:** 1–2 weeks

### A1 — PostgreSQL Row-Level Security

**Why:** The application layer enforces tenant isolation, but any future code path, direct DB access, or SQL injection exploit bypasses this entirely without RLS. This is the most critical security gap.

**Deliverables:**
- Apply `migrations/001_tenant_rls_foundation.sql` to all environments
- Add RLS policies to all tenant-scoped tables: `users`, `clinic_inventory_items`, `inventory_adjustments`, `draft_purchase_orders`, `draft_po_lines`, `roster_entries`, `roster_entry_audit`, `timesheet_entries`, `leave_requests`, `invoices`, `invoice_line_items`, `payment_records`, `audit_events`
- Set `app.user.clinic_id` as the Postgres session variable before each query
- Test that cross-tenant queries return 0 rows at the DB layer
- Register all RLS migrations in the bootstrap runner

**Dependencies:** None — can begin immediately  
**Estimated Effort:** 2–3 days

---

### A2 — Real TOTP Multi-Factor Authentication

**Why:** The MFA code bypass (`000000`) is gated behind `NODE_ENV !== 'production'` but real TOTP has never been implemented. Privileged roles (`owner_admin`, `group_practice_manager`) should require TOTP before accessing financial and patient data.

**Deliverables:**
- Add `otplib` (or equivalent) to Backend dependencies
- Add `totp_secret` column to `users` table (new migration)
- `POST /auth/mfa/setup` — generate TOTP secret + QR code for enrollment
- `POST /auth/mfa/verify` — validate TOTP code; issue session token
- Frontend: MFA enrollment flow (show QR, confirm code)
- Frontend: MFA challenge on login for enrolled users
- Remove DEV_MFA_CODE bypass entirely (or gate strictly behind `NODE_ENV=test`)
- Update seed to set `mfa_enabled: false` by default (users enrol on first login)

**Dependencies:** None  
**Estimated Effort:** 2–3 days

---

### A3 — Refresh Token Redis Persistence

**Why:** Refresh tokens are currently stored in an in-memory Map inside `authService`. Any multi-instance deployment (Render scale-out, restarts) invalidates all active sessions. Redis is already wired and gracefully available.

**Deliverables:**
- Move refresh token store from in-memory Map to Redis (TTL = 7 days)
- Update `authService.storeRefreshToken`, `validateRefreshToken`, `revokeRefreshToken`, `revokeAllUserTokens` to use Redis
- Ensure graceful fallback (if Redis unavailable, fall back to in-memory with warning log)
- Test token revocation across simulated restarts

**Dependencies:** Redis client already wired in `bootstrap/dependencies.ts`  
**Estimated Effort:** 1 day

---

### A4 — Deployment Configuration

**Why:** No deployment configuration file exists in the repository. The first production deploy requires infrastructure-as-code.

**Deliverables:**
- `render.yaml` (or platform equivalent) defining:
  - Backend web service (Node.js, `npm run start`, environment vars)
  - PostgreSQL managed database (Render Postgres)
  - Redis managed instance
  - Health check path (`/health`)
- `Backend/.env.production.example` updated with all required vars
- `Frontend-Web/.env.production` updated with correct `VITE_API_BASE_URL`
- README: deployment instructions for Render

**Dependencies:** A1, A2, A3 recommended first  
**Estimated Effort:** 1 day

---

### A5 — Frontend Test Coverage Expansion

**Why:** 13 of 16 frontend pages have zero tests. Any frontend regression goes undetected. This is critical before adding more frontend features.

**Deliverables:**
- Vitest tests for all 16 pages (minimum: renders without crashing + RBAC guard tests)
- Priority pages: `BillingLedgerPage`, `RosterCalendarPage`, `TimesheetsPage`, `LeavePage`
- Mock API client (`vi.mock('../api/client')`) pattern established in helpers
- Frontend test count target: 60+ tests (from current ~5)

**Dependencies:** None  
**Estimated Effort:** 3–4 days

---

**Phase A Exit Criteria:**
- RLS applied and verified with cross-tenant query tests
- Real TOTP enrolled and working for privileged roles
- Redis refresh token store passing under simulated restart
- `render.yaml` present and reviewed
- Frontend test count ≥ 60

---

## Phase B — Forecasting UX Completion

**Objective:** Make the forecasting tools genuinely useful by connecting them to real data, adding materials forecast UI, and ensuring the commission attendance workflow is smooth.

**Target Timeframe:** 1 week

### B1 — Materials Forecast Frontend Page

**Why:** `forecastService.ts` (materials consumption) is fully implemented on the backend but has no dedicated frontend page. Only labor forecast has a UI.

**Deliverables:**
- New `MaterialsForecastPage.tsx` at `/forecast/materials`
- KPI cards: top consumed items, projected replenishment dates, low-stock alerts
- Table: item name, average daily consumption, current stock, days remaining
- Integration with `forecastService` `/clinics/:id/forecast/materials` endpoint
- Nav link in AppShell (managers/admins only)
- Corresponding hook `useMaterialsForecast.ts`

**Dependencies:** Phase A optional  
**Estimated Effort:** 1.5 days

---

### B2 — Commission Attendance Verification UI

**Why:** Commission providers (dentists paid by percentage-of-collections) have `pending_verification` timesheet entries. A manager must verify attendance before the forecasting engine counts their shifts. No dedicated UI exists for this verification workflow.

**Deliverables:**
- Commission verification panel on `TimesheetsPage` (separate tab/section from hourly)
- List pending_verification commission logs with provider name, shift date, shift type
- Verify (mark present/absent/sick) with optional commission_note
- Bulk verify by date range
- Visual indicator on the analytics dashboard when unverified commission logs exist

**Dependencies:** Timesheets page already built  
**Estimated Effort:** 1 day

---

### B3 — Forecast Alerts Backend

**Why:** The forecast endpoint already computes low-stock projections. The routes include an `/alerts` path but it is not yet implemented.

**Deliverables:**
- `GET /clinics/:id/forecast/alerts` — returns items with projected stock-out within N days
- Configurable threshold (default: 7 days)
- Alert type: `low_stock`, `reorder_due`, `pending_po_aging`
- Frontend: alert badge on AppShell nav for Inventory link
- Frontend: alert panel on HomePage dashboard

**Dependencies:** None  
**Estimated Effort:** 1 day

---

**Phase B Exit Criteria:**
- Materials forecast page live with real data
- Commission attendance verification workflow complete
- Forecast alerts endpoint live and surfaced in UI

---

## Phase C — Billing Completeness & SaaS Payments

**Objective:** Complete the billing module to the point where it is usable for real clinical invoicing. This requires PDF generation, payment gateway, and overdue automation.

**Target Timeframe:** 2–3 weeks

### C1 — Invoice PDF Generation

**Why:** Clinics need to print or email invoices to patients. A billing module without printable invoices is not clinically useful.

**Deliverables:**
- Add PDF generation library to Backend (PDFKit recommended — no native binary deps)
- `GET /clinics/:id/billing/invoices/:invoiceId/pdf` — returns `application/pdf`
- PDF template: clinic name/ABN, patient name, invoice number, issue date, due date, line items, GST summary, payment status, payment instructions
- Frontend: "Download PDF" button on BillingLedgerPage per issued invoice
- Frontend: `downloadInvoicePdf(clinicId, invoiceId)` in api/client.ts (blob URL pattern, matching CSV export)

**Dependencies:** None  
**Estimated Effort:** 2 days

---

### C2 — Overdue Invoice Scheduler

**Why:** Invoices with a `due_at` timestamp that passes without full payment should automatically transition to `overdue` status. Currently this never happens automatically.

**Deliverables:**
- Background process or endpoint to mark invoices overdue
- Option A (recommended): Startup interval using `setInterval` in `index.ts` (simple, no infra)
- Option B: External cron trigger via Render cron job hitting `POST /admin/invoices/mark-overdue`
- `BillingService.markOverdueInvoices()` — queries `issued/partially_paid` invoices where `due_at < now()` and transitions to `overdue`
- Frontend: `overdue` status badge in BillingLedgerPage
- Analytics: overdue invoice count in dashboard KPIs

**Dependencies:** None  
**Estimated Effort:** 1 day

---

### C3 — Payment Gateway Integration (Stripe)

**Why:** The billing module records payment details but has no real payment capture. Stripe is the recommended gateway for Australian practices (supports EFTPOS, credit card, bank transfer).

**Deliverables:**
- Add `stripe` npm package to Backend
- `POST /clinics/:id/billing/invoices/:invoiceId/checkout` — creates Stripe PaymentIntent
- `POST /webhooks/stripe` — webhook handler (signature verification required)
- Webhook events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
- Payment record status updated on webhook receipt
- Frontend: "Pay Now" button linking to Stripe hosted checkout or embedded Elements
- Environment variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

**Dependencies:** C1 (for post-payment invoice PDF)  
**Estimated Effort:** 3–4 days

---

### C4 — Xero Accounting Adapter (Invoice Sync)

**Why:** Most Australian dental practices use Xero. Automatic invoice sync eliminates manual double-entry.

**Deliverables:**
- Xero OAuth 2.0 connection flow (clinic-level Xero tenant ID stored in clinics table)
- `POST /clinics/:id/billing/invoices/:invoiceId/sync-xero` — push invoice to Xero
- Map Verve invoice → Xero invoice (contact, line items, tax codes, reference)
- Map Verve payment → Xero payment record
- Handle Xero webhook for payment updates (optional)
- Frontend: "Sync to Xero" button per invoice
- New column: `clinics.xero_tenant_id` (nullable)

**Dependencies:** C1, C3  
**Estimated Effort:** 4–5 days

---

**Phase C Exit Criteria:**
- PDFs downloadable for all issued invoices
- Overdue invoices automatically marked
- Stripe payment capture working end-to-end in test mode
- Xero sync functional for a connected test clinic

---

## Phase D — Analytics Completeness

**Objective:** Extend the analytics module to cover cross-clinic reporting, export, and the remaining KPI views that are currently stub implementations.

**Target Timeframe:** 1 week

### D1 — Cross-Clinic Analytics (Owner Admin)

**Why:** `owner_admin` manages multiple clinics and needs a rolled-up view. The current analytics endpoints are per-clinic only.

**Deliverables:**
- `GET /analytics/dashboard` (no clinicId) — aggregate KPIs across all clinics for owner_admin
- `GET /analytics/revenue` (no clinicId) — cross-clinic revenue comparison chart
- `analyticsService.getOwnerDashboard(ownerId)` — aggregates billing/inventory/roster across all clinics
- Frontend: owner-admin homepage dashboard with multi-clinic KPI cards
- Clinic selector on existing analytics pages

**Dependencies:** Phase A (security hardening recommended before exposing cross-clinic data)  
**Estimated Effort:** 2 days

---

### D2 — Audit Event CSV Export

**Why:** Clinic owners need to export their audit trail for compliance and regulatory reporting (dental practice accreditation, health fund audits).

**Deliverables:**
- `GET /clinics/:id/analytics/audit-events/export.csv` — RFC 4180 CSV, same pattern as PO export
- Columns: timestamp, entity_type, entity_id, action, actor_email, metadata summary
- Date range filter (`?from=&to=`)
- Frontend: "Export CSV" button on AuditTrailPage
- Frontend: `exportAuditEventsCsv(clinicId, from, to)` in api/client.ts

**Dependencies:** None  
**Estimated Effort:** 1 day

---

### D3 — Staff Performance & Attendance Reports

**Why:** Managers need to review individual staff attendance rates, leave balances, and hour totals for performance management and payroll reconciliation.

**Deliverables:**
- `GET /clinics/:id/analytics/staff/:staffId/summary` — individual staff report
- Covers: total hours, overtime hours, leave days taken, attendance rate, commission shifts
- `GET /clinics/:id/analytics/staff` extended with per-staff row breakdown
- Frontend: staff detail modal from AnalyticsDashboardPage staff table
- Excel-style export of staff attendance summary (CSV)

**Dependencies:** D1 optional  
**Estimated Effort:** 1.5 days

---

**Phase D Exit Criteria:**
- Owner-admin sees cross-clinic dashboard
- Audit event CSV export working
- Staff performance report accessible per staff member

---

## Phase E — Production Hardening

**Objective:** Harden the platform for real-world production operation at scale. This phase is run before onboarding the first paying clinic.

**Target Timeframe:** 2–3 weeks (partly parallelisable)

### E1 — Payroll Export Adapter

**Why:** Timesheets are approved but cannot be exported to payroll software. This is the final step before payroll processing is possible.

**Deliverables:**
- `GET /clinics/:id/timesheets/export.csv` — generic CSV export of approved hourly entries
- Columns: staff name, staff email, shift date, ordinary hours, overtime bands, total pay (if rate configured)
- Xero Payroll adapter (map to Xero Payroll earnings lines)
- MYOB AccountRight adapter (optional)
- KeyPay adapter (optional — popular in Australian dental)
- Frontend: "Export Payroll" button on TimesheetsPage with format selector
- Filter by date range and approval status

**Dependencies:** Phase A  
**Estimated Effort:** 3–4 days (CSV: 1 day; Xero Payroll: 2–3 days)

---

### E2 — PO Receiving Workflow

**Why:** Submitted purchase orders need to be marked as received. On receipt, stock should be automatically incremented.

**Deliverables:**
- `PATCH /clinics/:id/purchase-orders/:poId/receive` — mark as received with received quantities
- `inventoryRepository.receivePurchaseOrder(clinicId, poId, lines)` — increments stock, records `receive` adjustment
- PO status: `draft → submitted → received` (new state)
- Frontend: "Mark Received" action on PurchaseOrdersPage for submitted orders
- Receiving discrepancy tracking (ordered qty vs received qty)

**Dependencies:** Inventory schema already supports `receive` adjustment type  
**Estimated Effort:** 1.5 days

---

### E3 — API Rate Limiting (Data Routes)

**Why:** Auth routes are rate-limited but all data endpoints (inventory, billing, roster) are unlimited. This is a DoS and abuse vector.

**Deliverables:**
- Configurable rate limiter middleware applied to all writable routes
- Higher limit for reads (e.g. 200/min); stricter for writes (e.g. 30/min)
- Per-clinic rate limiter (not global) using `clinic_id` as the key
- Appropriate `429 TOO_MANY_REQUESTS` error response

**Dependencies:** None  
**Estimated Effort:** 1 day

---

### E4 — OpenAPI Specification Update

**Why:** The OpenAPI spec (`api/openapi.yaml`) is stale at v0.4.0 (scan module). 10+ new modules are completely undocumented in the spec, making it useless for integrations.

**Deliverables:**
- Update `api/openapi.yaml` to v1.0.0
- Document all routes: billing, roster, timesheets, leave, forecasting, analytics, clinic settings
- Add all request/response schemas
- Add auth bearer scheme documentation
- Consider `swagger-ui-express` to serve docs at `/api/docs` in non-production

**Dependencies:** None (documentation task)  
**Estimated Effort:** 2–3 days

---

### E5 — Migration CLI Tool

**Why:** The current bootstrap runner runs migrations on app startup. A proper CLI tool is needed for: running migrations in CI/CD pipelines, rolling back specific migrations, checking migration status, and running migrations against different environments independently of the app.

**Deliverables:**
- `Backend/scripts/migrate.ts` — CLI: `migrate up`, `migrate down`, `migrate status`
- Support `--env` flag for targeting different DATABASE_URLs
- `migrate down` runs `.down.sql` files from `migrations/` directory
- CI step updated to run `migrate up` before tests when DATABASE_URL is set
- Existing bootstrap runner preserved for cold-start compatibility

**Dependencies:** None  
**Estimated Effort:** 2 days

---

### E6 — Supplier Email Integration

**Why:** Submitted purchase orders need to be sent to the actual supplier. Currently the submit action only changes the status in the database.

**Deliverables:**
- `suppliers` table — supplier name, email, product SKUs mapping
- `clinics.default_supplier_email` — fallback contact
- `POST /clinics/:id/purchase-orders/:poId/send` — email PO to supplier
- Email service integration (Resend or SendGrid recommended)
- PDF attachment (draft-style PO document)
- Environment variables: `RESEND_API_KEY` or `SENDGRID_API_KEY`
- Frontend: "Send to Supplier" button post-submit

**Dependencies:** C1 (PDF generation)  
**Estimated Effort:** 2 days

---

**Phase E Exit Criteria:**
- Payroll export to CSV + Xero Payroll
- PO receiving workflow complete
- All writable endpoints rate-limited
- OpenAPI spec at v1.0.0
- Migration CLI operational
- Supplier email sending working end-to-end

---

## Roadmap Summary

| Phase | Objective | Key Deliverables | Estimated Effort | Priority |
|-------|-----------|-----------------|-----------------|----------|
| A — MVP Completion | Security + deployment hardening | RLS, TOTP, Redis tokens, deploy config, frontend tests | ~10 days | **Critical** |
| B — Forecasting UX | Complete the forecast feature set | Materials forecast page, commission attendance UI, alerts | ~3.5 days | High |
| C — Billing & SaaS | Clinically-useful billing | PDF, overdue scheduler, Stripe, Xero sync | ~10–12 days | High |
| D — Analytics | Cross-clinic reporting + export | Owner dashboard, CSV export, staff reports | ~4.5 days | Medium |
| E — Production Hardening | Operational readiness | Payroll export, PO receiving, rate limiting, OpenAPI, migration CLI, supplier email | ~11 days | Medium |

**Total estimated remaining effort:** ~40–42 developer-days

---

## Dependencies Between Phases

```
Phase A (Security)
    └── Phase C.3 (Stripe gateway — needs secure auth)
    └── Phase D.1 (Cross-clinic analytics — needs RLS)
    └── Phase E.1 (Payroll export — needs secure auth)

Phase C.1 (PDF)
    └── Phase C.3 (Stripe — post-payment PDF)
    └── Phase E.6 (Supplier email — PO PDF attachment)

Phase B — independent (can run in parallel with Phase C/D)
Phase D.2, D.3 — independent of Phase C
Phase E.2, E.3, E.4, E.5 — independent of Phase C
```

**Recommended parallel tracks (if multiple developers available):**
- Track 1: Phase A → Phase C
- Track 2: Phase B → Phase D (can begin simultaneously)
- Track 3: Phase E items E4 (OpenAPI) and E5 (migration CLI) — documentation/infrastructure tasks anytime
