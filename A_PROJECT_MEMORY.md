# Verve Dental SaaS - PROJECT MEMORY

**Purpose:** This document is Cursor's long-term memory source. Update it after each module completion to maintain architectural context across sessions.

**Last Updated:** June 2026  
**Current Phase:** Sprint 4C Complete — Cookie-Only Refresh Tokens  
**Grade:** Enterprise (Production-Ready, Australian-Compliant)  
**Status:** 25 backend suites / **506/506 tests green** + 4 frontend suites / **16/16 tests green** — 0 TypeScript errors — 0 lint warnings

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
- [x] In-memory user repository (seed dev accounts) — fallback when `DATABASE_URL` absent
- [x] PostgreSQL user repository (`userRepository.postgres.ts`) — used when `DATABASE_URL` is set
- [x] Bootstrap migration runner (`db/migrate.ts`) — applies `003_users_schema` on cold start
- [x] Demo user seed (`db/seed.ts`) — bcrypt-hashes and inserts 4 accounts if `users` table empty
- [x] `AppError` + hardened error handler
- [x] CORS restricted to `CORS_ORIGIN`
- [x] `trust proxy` set so `req.ip` resolves real client IP behind Render load balancer
- [x] `express-rate-limit` on `/auth/login`, `/auth/mfa/verify`, `/auth/refresh`
- [x] Full schema migrations CLI — bootstrap runner covers migrations 003–015 (Module 13 complete)
- [x] **Sprint 4A** — HttpOnly refresh-token cookie bridge (`cookie-parser`, `setRefreshCookie`/`clearRefreshCookie` in authController, cookie-first with body fallback on `/auth/refresh` and `/auth/logout`)
- [x] **Sprint 4B** — Frontend cookie migration: `tokenStorage.ts` stores access token only; `AuthContext` calls `refresh()` with no body on session restore; `logout()` sends no `refreshToken`; all `fetch` calls use `credentials: "include"`
- [x] **CI Cleanup** — Fixed all GitHub Actions lint failures: `AuthContext.tsx` split into `AuthContext.tsx` (context def) + `AuthProvider.tsx` (component, fast-refresh clean); `rlsTenantContextMiddleware` `_pool` param removed; `rlsIsolation/rlsHardening.test.ts` dead `!pool` condition removed; typed `bodyData` helpers + `!` assertions replaced with `as` casts in 6 backend test files; `require-await`/`unbound-method`/unused-var issues fixed in `pendingMfaEncryption`/`rlsHardening` tests
- [x] **Sprint 4C** — Legacy refresh-token bridge fully removed: `refreshToken` stripped from all JSON response bodies (login, MFA verify, refresh); body-token fallback removed from `/auth/refresh` and `/auth/logout`; `refreshSchema`/`logoutSchema` deleted; `AuthSession`/`LoginResponse` frontend types trimmed; `tests/helpers/auth.ts` updated to cookie-based `loginAndGetTokens`; `authCookie.test.ts` rewritten for cookie-only contract; `authSession.test.ts` fully migrated to cookie-based helpers; `health.test.ts`, `mfaEnrollment.test.ts`, `totpEncryption.test.ts`, and `authCookieMigration.test.tsx` updated
- [x] Database RLS policies — Module 13 complete (14 tables, 17 policies, `withTenantContext`, AsyncLocalStorage pool hook)

### Dev seed accounts (password: `password123`)

> All accounts have `mfa_enabled = false` in the PostgreSQL seed — real TOTP is wired in Module 04+.
> The DEV_MFA_CODE (`000000`) bypass is blocked in `NODE_ENV=production` (already applied).

| Email | Role | Clinic | MFA |
|-------|------|--------|-----|
| `admin@clinic-a.au` | owner_admin | Clinic A | No (seeded with false) |
| `manager@clinic-a.au` | group_practice_manager | Clinic A | No (seeded with false) |
| `staff@clinic-a.au` | clinical_staff | Clinic A | No |
| `admin@clinic-b.au` | owner_admin | Clinic B | No |

### Architectural Conventions (established in Module 01 review)
- **Throwing errors:** Always use `AppError` for operational errors (auth, validation, not-found). Raw `Error` is for unexpected/programmer errors only.
- **CORS:** Controlled by `CORS_ORIGIN` env var. Never use `cors()` with no options.
- **Production safety:** Error handler redacts `.message` from unhandled errors in `NODE_ENV=production`.
- **Frontend API base:** `VITE_API_BASE_URL=""` (empty) means same-origin via Vite proxy. Set to full URL in production.
- **Auth:** Access token in `Authorization: Bearer` stored in `localStorage` via `tokenStorage.ts`. Refresh token is **never stored client-side** — Sprint 4B migrated to HttpOnly cookie (set by backend on login/MFA/refresh). `credentials: "include"` on all `fetch` calls.

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

### Security Hotfix (applied post-Module 03 security review)
- [x] `DEV_MFA_CODE = "000000"` gated behind `NODE_ENV !== "production"` in `authService.ts`
- [x] Seed credentials + dev hint paragraph stripped from `LoginPage.tsx`
- [x] `app.set('trust proxy', 1)` in `app.ts` — real client IP in audit logs behind Render LB
- [x] `express-rate-limit` on all auth routes (login / mfa verify / refresh)
- [x] PostgreSQL user repository + bootstrap migration + demo seed (users persist across redeploys)

### Task 5 — User Management (complete)
- [x] `UserRepository` interface extended: `createUser(input)` + `listByClinic(clinicId)`
- [x] Both Postgres (`userRepository.postgres.ts`) and in-memory fallback implement the new methods
- [x] `UserService` (`services/userService.ts`) — RBAC-aware:
  - `owner_admin` can create any role for any clinic
  - `group_practice_manager` can only create `clinical_staff` for their own clinic
  - `clinical_staff` has no access
- [x] `GET /clinics/:clinicId/users` — list users in a clinic
- [x] `POST /clinics/:clinicId/users` — create a new staff account (email, password, role, clinicName)
- [x] `AuthAuditEvent` extended with `user.created`
- [x] Frontend `ManageUsersPage` (`/users`) — staff table + inline "Add user" form, role-gated
- [x] `AppShell` nav shows "Users" link for `owner_admin` and `group_practice_manager` only
- [x] API client (`listUsers`, `createUser`) + types (`StaffUser`, `CreateUserRequest`) added
- [x] `ROLE_LABELS` + `canManageUsers()` added to `utils/roles.ts`

### Schema Architecture — Clinic Context (IMPORTANT for Roster/Timesheet design)

| Field | Location | Meaning |
|-------|----------|---------|
| `home_clinic_id` | `users` table (JWT payload) | Permanent payroll/contract location. Used for payroll reporting. |
| `rostered_clinic_id` | Future `roster_entries` table | The clinic a staff member is physically working at on a given shift. |
| `:clinicId` URL param | All tenant-scoped routes | The clinic whose data is currently being accessed. |

- `enforceTenantParam` in `authMiddleware.ts` compares `req.user.homeClinicId` against the URL `:clinicId`.
- When Roster module is built, add a `roster_entries` table with `staff_user_id` + `rostered_clinic_id` + `shift_date`. Payroll reports group by `users.home_clinic_id`; scheduling views group by `roster_entries.rostered_clinic_id`.
- The `resolveTenantClinicId()` helper in `db/tenantContext.ts` has a comment marking the future roster-lookup extension point.

### Task 6 — Production Hardening (in progress)

#### Task 6.1 — Password Change & Reset (complete)
- [x] `UserRepository` interface extended: `updatePassword(userId, hashedPassword)`
- [x] In-memory and Postgres repositories both implement `updatePassword`
- [x] Bugfix: `userRepository.postgres.ts` `listByClinic` was querying `clinic_id`; corrected to `home_clinic_id`
- [x] `AuthAuditEvent` extended with `auth.password.changed` and `auth.password.reset`
- [x] `AuthService.changePassword(userId, currentPassword, newPassword, auditContext)` — bcrypt verify + hash + `revokeAllUserTokens` on success
- [x] `AuthService.revokeAllUserTokens(userId)` — purges all in-memory refresh tokens for a user
- [x] `UserService.resetPassword(caller, targetUserId, newPassword)` — RBAC-gated admin/manager reset; calls `revokeAllUserTokens`
- [x] `POST /auth/change-password` (authenticated) — self-service password change
- [x] `POST /clinics/:clinicId/users/:userId/reset-password` (owner_admin / group_practice_manager) — admin reset
- [x] Frontend `AccountPage` (`/account`) — account info + change-password form; auto-logs out after success
- [x] `AppShell` header updated: user email link → `/account`, "Log out" button
- [x] `ManageUsersPage` — inline "Reset password" per-row action with inline form
- [x] `api/client.ts` extended: `changePassword`, `resetUserPassword`
- [x] Pre-existing test bugs fixed: `health.test.ts` `clinicId` → `homeClinicId`; `scanApi.test.ts` `ScanResponse.barcode` type missing `mapping`
- [x] 50/50 backend tests pass; 0 TypeScript errors (both workspaces)

#### Task 6.2 — Inventory PostgreSQL Persistence (complete)
- [x] `005_inventory_schema` bootstrap migration added to `db/migrate.ts` — idempotent ENUMs via `DO $$ EXCEPTION WHEN duplicate_object`, `CREATE TABLE/INDEX IF NOT EXISTS` for all tables
- [x] `catalogRepository.postgres.ts` — implements full `CatalogRepository` interface against `master_catalog_items` + `barcode_mappings`
- [x] `inventoryRepository.postgres.ts` — implements full `InventoryRepository` interface; `listClinicInventory` / `findClinicInventoryItem` use SQL JOIN to build `ClinicInventoryItemView` natively
- [x] `db/seed.ts` extended with `seedInventory()` — seeds 5 master items, 6 barcodes, 10 clinic stock rows using same fixed UUIDs as in-memory seed; runs only when `master_catalog_items` is empty
- [x] `bootstrap/dependencies.ts` factory updated — when `DATABASE_URL` is set, all three repos (users, catalog, inventory) switch to Postgres; `AppDependencies` typed against repo interfaces not concrete implementations
- [x] 50/50 backend tests pass; 0 TypeScript errors

#### Task 6.3 — Draft PO Frontend Panel (complete)
- [x] `purchaseOrderController.ts` — enriches `DraftPoLine[]` with catalog item names/SKUs via parallel `findMasterItemById` batch; `orderStatus: "draft"` until submit flow added in Module 04
- [x] `purchaseOrderRoutes.ts` — `GET /` behind `owner_admin` / `group_practice_manager` RBAC + tenant enforcement
- [x] `GET /clinics/:clinicId/purchase-orders` mounted in `routes/index.ts`
- [x] Frontend `PurchaseOrderLine` type added to `types/inventory.ts`
- [x] `api/client.ts` extended with `listPurchaseOrders(clinicId)`
- [x] `PurchaseOrdersPage` (`/purchase-orders`) — sortable table (item, qty needed, trigger reason, Draft badge, timestamp) + summary stats card (total lines, total units, unique SKUs)
- [x] `AppShell` nav: "Purchase Orders" link added for managers/admins
- [x] 50/50 backend tests pass; 0 TypeScript errors (both workspaces)

### Task 6 — Production Hardening COMPLETE ✓
All three sub-tasks delivered with zero TypeScript errors and 50/50 tests green across every session.

---

## Module 04 — Rostering & Scheduling

### Session 1 complete — Backend CRUD infrastructure

#### New files
- [x] `src/types/roster.ts` — `ShiftType`, `RosterStatus`, `RosterAuditAction`, `RosterEntry`, `RosterEntryAudit`, `CreateRosterEntryInput`, `UpdateRosterEntryInput`, `ListRosterOptions`
- [x] `src/repositories/rosterRepository.ts` — `RosterRepository` interface + in-memory implementation
- [x] `src/repositories/rosterRepository.postgres.ts` — Postgres implementation (with `roster_entry_audit` JSONB snapshot writes)
- [x] `src/services/rosterService.ts` — RBAC + cross-clinic access control; injected with `userRepository` to look up staff email on create
- [x] `src/controllers/rosterController.ts` — Zod-validated request handlers, serializes Date → ISO string
- [x] `src/routes/rosterRoutes.ts` — NO `enforceTenantParam` (service handles async roster-membership check)
- [x] `tests/rosterApi.test.ts` — 16 tests covering CRUD, RBAC, cross-clinic access

#### Modified files
- [x] `src/db/migrate.ts` — added `006_roster_schema`: ENUMs (`shift_type`, `roster_status`, `roster_audit_action`), `roster_entries` table (TIMESTAMPTZ start/end, `shift_end_at > shift_start_at` constraint), `roster_entry_audit` table (JSONB snapshot), 4 indexes
- [x] `src/bootstrap/dependencies.ts` — `rosterRepository` + `userRepository` added to `AppDependencies`; both repos wired for Postgres and in-memory paths
- [x] `src/routes/index.ts` — `GET|POST|PATCH|DELETE /clinics/:clinicId/roster[/:entryId]` + `/me` mounted

#### REST API surface
| Method | Path | Auth |
|--------|------|------|
| `GET` | `/clinics/:clinicId/roster` | All roles (with cross-clinic roster-membership check) |
| `POST` | `/clinics/:clinicId/roster` | owner_admin, group_practice_manager (own clinic) |
| `GET` | `/clinics/:clinicId/roster/me` | All roles |
| `GET` | `/clinics/:clinicId/roster/:entryId` | All roles |
| `PATCH` | `/clinics/:clinicId/roster/:entryId` | owner_admin, group_practice_manager (own clinic) |
| `DELETE` | `/clinics/:clinicId/roster/:entryId` | owner_admin, group_practice_manager (own clinic — sets status=cancelled) |

#### Cross-clinic access design (IMPORTANT)
- `owner_admin` — unrestricted read/write to any clinic's roster
- `group_practice_manager` — read/write to own `homeClinicId` only
- `clinical_staff` — read own `homeClinicId` roster OR any clinic where `hasActiveShiftAtClinic(userId, clinicId)` returns true
- The `resolveTenantClinicId()` helper is **not** used on roster routes. `RosterService` performs its own async tenant check including the DB lookup.
- The extension point in `tenantContext.ts` comment ("roster-membership lookup") is now fulfilled by `RosterService.assertClinicReadAccess`.

#### Shift type ENUM
| Value | Description |
|-------|-------------|
| `standard` | Regular scheduled shift (default) |
| `overtime` | Paid overtime shift |
| `on_call` | On-call coverage |
| `training` | Internal training day |

#### Roster status lifecycle
```
scheduled → confirmed → completed
         ↘ cancelled (terminal, any stage)
```

#### Test count
66/66 tests passing, 0 TypeScript errors (both workspaces)

### Session 2 complete — Frontend roster calendar/grid UI

#### New files
- [x] `Frontend-Web/src/types/roster.ts` — `RosterEntry`, `CreateShiftRequest`, `UpdateShiftRequest`, `SHIFT_TYPE_LABELS`, `ROSTER_STATUS_LABELS`, `ALL_SHIFT_TYPES`
- [x] `Frontend-Web/src/pages/RosterCalendarPage.tsx` — weekly 7-column grid with week navigation, shift cards (colour-coded by status), create/edit modal, cancel-shift action
- [x] `Frontend-Web/src/pages/MyShiftsPage.tsx` — personal upcoming + recent shifts list, cross-clinic indicator, duration label, status + type badges

#### Modified files
- [x] `Frontend-Web/src/api/client.ts` — `listRoster`, `getMyShifts`, `createShift`, `updateShift`, `cancelShift` (5 new methods)
- [x] `Frontend-Web/src/utils/roles.ts` — `canManageRoster()` helper added
- [x] `Frontend-Web/src/App.tsx` — `/roster` → `RosterCalendarPage`, `/my-shifts` → `MyShiftsPage` routes added
- [x] `Frontend-Web/src/components/layout/AppShell.tsx` — "Roster" + "My Shifts" nav links (visible to all roles)
- [x] `Frontend-Web/src/index.css` — ~300 lines of new roster styles (calendar grid, shift cards, type/status badges, modal, form, my-shifts list)

#### Calendar UX design
- Week navigation: ‹ / › buttons + "Today" shortcut
- Day columns: `Mon–Sun`, today highlighted in blue
- Shift cards: staff name, `HH:mm–HH:mm`, shift type badge — 4 colours (standard=blue, overtime=amber, on_call=purple, training=green)
- Status colours: scheduled=light-blue, confirmed=light-green, completed=gray, cancelled=red+faded
- Read-only for `clinical_staff`; click-to-edit + "Cancel shift" for managers/admins
- Mobile: grid scrolls horizontally (`min-width: 700px` with `overflow-x: auto`)

#### Modal form fields
| Field | Control | Notes |
|-------|---------|-------|
| Staff member | `<select>` from `listUsers` | Hidden when editing (shown as static text) |
| Date | `<input type="date">` | Pre-filled with clicked day column |
| Start / End time | `<input type="time">` pair | Defaults 08:00 / 17:00 |
| Shift type | `<select>` | standard / overtime / on_call / training |
| Notes | `<textarea>` | Optional, max 1000 chars |

#### TypeScript status
0 TS errors in both `Frontend-Web` and `Backend` workspaces

---

---

## Module 05 — Payroll, Timesheets, and Leave Management

### Session 1 in progress — Schema migration

#### New migration: `008_payroll_and_leave_schema` (added to `src/db/migrate.ts`)

##### ENUMs introduced

| ENUM | Values |
|------|--------|
| `payroll_type` | `hourly_auto`, `hourly_manual`, `commission_log` |
| `attendance_status` | `pending_verification`, `present`, `absent`, `sick`, `cancelled` |
| `timesheet_approval_status` | `pending`, `approved`, `rejected`, `requires_amendment` |
| `leave_type` | `annual`, `sick`, `personal`, `unpaid`, `other` |
| `leave_request_status` | `pending`, `approved`, `rejected`, `withdrawn` |

##### Tables introduced

**`timesheet_entries`** — Unified table for both payroll tracks:
- `payroll_type` discriminator column (hourly vs commission)
- Dual clinic context: `clinic_id` (home/payroll) + `rostered_clinic_id` (physical location)
- Nullable `roster_entry_id` FK — NULL for `hourly_manual` back-fill entries
- `shift_date` denormalized from `shift_start_at` for efficient date-range scans
- Hourly track fields: `clock_in_at`, `clock_out_at`, `break_duration_minutes`
- Accounting-agnostic hour buckets: `total_hours_worked`, `ordinary_hours`, `overtime_1_5x_hours`, `overtime_2x_hours`, `overtime_custom_hours`
- Approval workflow: `approval_status`, `approved_by_user_id`, `approved_at`, `approval_notes`
- Commission annotation: `commission_note`
- `UNIQUE NULLS NOT DISTINCT (roster_entry_id, payroll_type)` — prevents duplicate system-generated entries per roster shift
- `generated_by` varchar: `'system_auto'`, `'manager_manual'`, or user email

**`leave_requests`** — Australian Fair Work compliant leave tracking:
- Date range with `total_days numeric(6,2)` (supports half-days)
- Manager approval workflow (`reviewed_by_user_id`, `reviewed_at`, `review_notes`)

##### Key architectural decisions

**Why unified `timesheet_entries` table (not split)?**
The materials forecasting engine has a single query surface:
`WHERE attendance_status IN ('present'/'absent'/'sick') AND payroll_type = 'commission_log' AND shift_date = $1`.
Two separate tables would require a UNION in every forecast query.

**Forecasting safeguard rule (NON-NEGOTIABLE):**
- `commission_log` entries are **always created as `pending_verification`**, never `present`.
- `attendance_status = 'present'` → full material usage for that shift.
- `attendance_status IN ('absent', 'sick')` → material usage = **ZERO**.
- A manager must explicitly verify each commission provider's attendance.

**Accounting agnosticism:**
The `ordinary_hours`, `overtime_1_5x_hours`, `overtime_2x_hours`, `overtime_custom_hours` columns are pre-calculated generic numerics. Module 09's adapter layer maps these to Xero/MYOB/KeyPay/CSV field names at export time — no schema migration required to support a new accounting system.

##### Indexes

| Index | Columns | Predicate | Purpose |
|-------|---------|-----------|---------|
| `idx_timesheet_entries_staff_date` | `(staff_user_id, shift_date DESC)` | — | Staff payroll view |
| `idx_timesheet_entries_clinic_date` | `(clinic_id, shift_date DESC)` | — | Clinic payroll view |
| `idx_timesheet_entries_clinic_approval` | `(clinic_id, approval_status, shift_date)` | `payroll_type IN ('hourly_auto', 'hourly_manual')` | Manager approval queue |
| `idx_timesheet_attendance_forecast` | `(attendance_status, payroll_type, shift_date)` | `payroll_type = 'commission_log'` | **Materials forecasting hot path** |
| `idx_timesheet_entries_roster_entry` | `(roster_entry_id)` | `roster_entry_id IS NOT NULL` | Roster back-link |
| `idx_leave_requests_staff_date` | `(staff_user_id, start_date DESC)` | — | Staff leave history |
| `idx_leave_requests_clinic_status` | `(clinic_id, status, start_date)` | — | Manager leave queue |
| `idx_leave_requests_clinic_date_range` | `(clinic_id, start_date, end_date)` | `status = 'approved'` | Roster double-booking block |

#### TypeScript status
0 TS errors in `Backend` workspace

#### Next steps for Module 05
- [ ] `src/types/payroll.ts` — TypeScript types mirroring all 5 ENUMs + table shapes
- [ ] `src/repositories/timesheetRepository.ts` — interface + in-memory implementation
- [ ] `src/repositories/timesheetRepository.postgres.ts` — Postgres implementation
- [ ] `src/repositories/leaveRepository.ts` — interface + in-memory + Postgres
- [ ] `src/services/timesheetService.ts` — hourly clock-in/out, manager approval, commission log generation on roster completion
- [ ] `src/services/leaveService.ts` — request/approve/reject leave, roster block check
- [ ] REST API: `POST /clinics/:clinicId/timesheets/clock-in|clock-out`, `PATCH .../approve`, `GET .../pending-approval`
- [ ] REST API: `POST /clinics/:clinicId/leave`, `PATCH .../approve|reject`
- [ ] Commission log auto-generation hook in `RosterService` when status → 'completed'
- [ ] Frontend: Timesheets page (hourly approval queue + commission verification panel)
- [ ] Frontend: Leave requests page

---

### Next Planned Upgrades
- [ ] Real TOTP (authenticator app) for MFA — re-enable `mfa_enabled` for privileged roles

---

## Module 06 — Clinics Reference Table & Materials Forecasting

**Current Phase:** Module 06 Session 1 complete — Canonical Clinics Table

### Session 1 complete — Clinic entity, CRUD API, roster TODO resolved

#### New files
- [x] `src/types/clinic.ts` — `Clinic`, `CreateClinicInput`, `UpdateClinicInput`, `ClinicSubscriptionTier`
- [x] `src/repositories/clinicRepository.ts` — `ClinicRepository` interface + `InMemoryClinicRepository` (pre-seeded with Clinic A & B)
- [x] `src/repositories/clinicRepository.postgres.ts` — full Postgres implementation with dynamic SET clause for partial updates
- [x] `src/services/clinicService.ts` — RBAC-aware service: `getClinic`, `listClinics`, `updateClinic`; defence-in-depth access guards
- [x] `src/controllers/clinicController.ts` — Zod-validated handlers with `.strict()` on updateClinicSchema
- [x] `src/routes/clinicRoutes.ts` — `GET /` (enforceTenantParam) + `PATCH /` (requireRoles owner_admin), mounted at `/clinics/:clinicId`

#### Modified files
- [x] `src/db/migrate.ts` — `012_clinics_schema` added to `BOOTSTRAP_MIGRATIONS`; idempotent CREATE TABLE IF NOT EXISTS + partial indexes
- [x] `src/db/seed.ts` — `seedClinics()` function exported; inserts Clinic A + Clinic B with fixed UUIDs; called BEFORE seedDemoUsers (future FK dependency)
- [x] `src/bootstrap/dependencies.ts` — `clinicRepository` + `clinicService` added to `AppDependencies`; both Postgres and in-memory paths wired; `seedClinics` called in boot sequence
- [x] `src/routes/index.ts` — `GET /clinics` (list) mounted; `createClinicRouter` mounted AFTER all sub-path routers; `clinicHandlers` instantiated from `deps.clinicService`
- [x] `src/routes/rosterRoutes.ts` — `deps.clinicRepository` injected into `createRosterService` as 3rd argument
- [x] `src/services/rosterService.ts` — Module 06 TODO resolved: `clinicRepository.findById()` replaces `userRepository.getClinicName()` workaround; added `CLINIC_INACTIVE` guard for inactive clinic validation

#### REST API surface (Session 1)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/clinics` | All authenticated | owner_admin → all clinics; others → own clinic |
| `GET` | `/clinics/:clinicId` | All authenticated | enforceTenantParam enforces tenant boundary |
| `PATCH` | `/clinics/:clinicId` | owner_admin only | Partial update; unknown keys rejected (.strict()) |

#### Migration: `012_clinics_schema`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | gen_random_uuid() default |
| `name` | text NOT NULL | Canonical display name |
| `abn` | varchar(11) nullable | Australian Business Number |
| `address_line1`, `suburb`, `state`, `postcode` | text/varchar nullable | Contact address |
| `timezone` | text DEFAULT 'Australia/Sydney' | IANA timezone string |
| `subscription_tier` | varchar(20) DEFAULT 'standard' | standard / premium / enterprise |
| `is_active` | boolean DEFAULT true | Soft-delete flag |

#### Architectural decisions
- `SEED_CLINIC_A_ID` and `SEED_CLINIC_B_ID` remain defined in `userRepository.ts` (backward compatibility); `clinicRepository.ts` re-exports them as the canonical Module 06 source
- `clinicRepository` is a required (not optional) parameter of `createRosterService`; the service now fails at startup if omitted, making the Module 06 dependency explicit
- The `GET /clinics/:clinicId` route uses `enforceTenantParam` (middleware layer) AND `assertReadAccess` in the service layer (defence in depth)
- `createClinicRouter` mounted AFTER all sub-path routers so `/clinics/:clinicId/inventory` etc. are matched first; documented with a comment in index.ts

#### Test count
171/171 tests passing, 0 TypeScript errors (both workspaces)

### Session 4 complete — Frontend Labor Cost Dashboard

#### New files
- [x] `Frontend-Web/src/types/forecast.ts` — `RoleLaborProjection` + `LaborForecastSummary` types (mirrors backend laborForecastService output)
- [x] `Frontend-Web/src/hooks/useLaborForecast.ts` — data-fetching hook; auto-refetches on clinicId/forecastDays change; clamps days [1–90]
- [x] `Frontend-Web/src/components/forecast/LaborForecastSummaryCard.tsx` — KPI cards: grand total, hours, base cost, overhead cost, roles scheduled
- [x] `Frontend-Web/src/components/forecast/LaborForecastTable.tsx` — sortable table (5 columns); click-to-sort with ▲/▼ indicators; role colour badges; empty state
- [x] `Frontend-Web/src/pages/LaborForecastPage.tsx` — primary dashboard page; forecastDays slider (1–90) + number input; RBAC redirect for clinical_staff; tenant-scoped to homeClinicId; loading/error/empty state; methodology disclaimer card

#### Modified files
- [x] `Frontend-Web/src/api/client.ts` — `getLaborForecast(clinicId, forecastDays?)` method added
- [x] `Frontend-Web/src/utils/roles.ts` — `canViewLaborForecast(role)` helper added (owner_admin + group_practice_manager only)
- [x] `Frontend-Web/src/components/layout/AppShell.tsx` — "Labor Forecast" nav link for manager/admin roles
- [x] `Frontend-Web/src/App.tsx` — `/forecast/labor` → `LaborForecastPage` route added inside ProtectedRoute
- [x] `Frontend-Web/src/index.css` — ~230 lines: lf-controls, lf-summary KPI cards, lf-table, lf-disclaimer

#### Test & TypeScript status
- 11 suites / 230 backend tests — all green
- Frontend-Web `tsc --noEmit` → exit code 0, 0 errors
- Backend `tsc --noEmit` → exit code 0, 0 errors

### Session 5 complete — Clinic Settings Configuration Page

#### New files
- [x] `Frontend-Web/src/types/clinic.ts` — `ClinicData`, `UpdateClinicData`, `ClinicSubscriptionTier` frontend types (timestamps as ISO strings, not Date objects)

#### Modified files
- [x] `Frontend-Web/src/api/client.ts` — `getClinic(clinicId)` + `updateClinicSettings(clinicId, data)` added
- [x] `Frontend-Web/src/utils/roles.ts` — `canViewClinicSettings(role)` helper (owner_admin + group_practice_manager)
- [x] `Frontend-Web/src/components/layout/AppShell.tsx` — "Clinic Settings" nav link for managers/admins
- [x] `Frontend-Web/src/App.tsx` — `/settings/clinic` → `ClinicSettingsPage` route inside ProtectedRoute
- [x] `Frontend-Web/src/index.css` — ~130 lines: cs-tier-badge (standard/premium/enterprise), cs-field-error, cs-field-hint, cs-readonly-notice, cs-actions, cs-meta, cs-status-badge, disabled input state

#### Page: `ClinicSettingsPage.tsx`
- Loads via `GET /clinics/:clinicId` on mount; refresh button re-fetches
- **Section 1 — Practice Profile:** Clinic Name (required, 3–100 chars), ABN (strips spaces/hyphens, validates /^\d{9,11}$/), Timezone dropdown (7 AU zones), Subscription Tier read-only badge
- **Section 2 — Address:** Address Line 1, Suburb, State (dropdown, 8 AU states/territories), Postcode (4 digits)
- **Inline TypeScript validation** before every PATCH submission; per-field error messages with `aria-invalid` + `role="alert"`
- **RBAC tiers:**
  - `clinical_staff` → `<Navigate to="/" replace />` (redirect)
  - `group_practice_manager` → all fields disabled + amber "View only" notice; no Save button
  - `owner_admin` → full edit + Save / Reset actions; success/error banners
- **Metadata card** at bottom: Clinic ID (monospace), active status badge, created/updated timestamps
- `subscriptionTier` intentionally omitted from `UpdateClinicData` — read-only on the UI to prevent client-side tier escalation; tier changes require a billing workflow

#### Test & TypeScript status
- Frontend-Web `tsc --noEmit` → exit code 0, 0 errors
- 0 lint errors (ReadLints)
- 11 suites / 230 backend tests — all green (no changes to backend)

## Module 06 — COMPLETE ✓

All five sessions delivered with 0 TypeScript errors across both workspaces.

---

## Pre-Module 07 Hardening Pass — COMPLETE ✓

Executed as a pre-integration refactoring backlog before Module 07 (Xero/MYOB integration).
All four tasks delivered with 0 TypeScript errors (both workspaces) and 11 suites / 230 backend tests green.

### Task 1 — Floating-Point Ledger Safety (Minor Units)
**File:** `Backend/src/services/laborForecastService.ts`
- `DEFAULT_HOURLY_RATES` replaced by `DEFAULT_HOURLY_RATE_CENTS` (integers: 5000, 7500, 6250, 5000 c/hr).
- `CLINIC_WIDE_FALLBACK_RATE_CENTS = 5_500`.
- `RoleLaborProjection.projectedBaseCost`, `projectedOverheadCost`, `totalProjectedCost` — now INTEGER AUD CENTS.
- `LaborForecastSummary.totalProjectedBaseCost`, `totalProjectedOverheadCost`, `grandTotalProjectedCost` — INTEGER AUD CENTS.
- `round2dp` retained for HOURS only; costs use `Math.round()` on integer cents.
- `LaborForecastOptions.timezone?: string` added for timezone calibration (Task 4).

**File:** `Backend/src/routes/laborForecastRoutes.ts`
- `toSummaryDTO()` helper performs the EXCLUSIVE division-by-100 before JSON response.
- Clinic timezone fetched from `clinicRepository.findById()` and forwarded to service.

**File:** `Backend/tests/laborForecastService.test.ts`
- All cost `toBe()` assertions updated to integer cents (e.g. `450` → `45000`).

### Task 2 — Inventory Query Truncation (Predicate Push-Down)
**File:** `Backend/src/repositories/inventoryRepository.ts`
- `InventoryRepository` interface extended with `getConsumptionVolume(clinicId, { type, since })`.
- In-memory implementation: filters `adjustments` array by clinic, type, and `createdAt >= since`.

**File:** `Backend/src/repositories/inventoryRepository.postgres.ts`
- Postgres implementation: `GROUP BY master_catalog_item_id` with `WHERE adjustment_type = $2 AND created_at >= $3`.

**File:** `Backend/src/services/forecastService.ts`
- Removed dangerous `listAdjustments(clinicId, { limit: 200 })` + post-query filter block.
- Now calls `inventoryRepository.getConsumptionVolume(clinicId, { type: 'scan_deduct', since: lookbackSinceUTC })`.
- `ForecastOptions.timezone?: string` added (Task 4).

### Task 3 — Clinic Validation Hardening
**File:** `Backend/src/controllers/clinicController.ts`
- ABN schema: `.transform(v => v.replace(/[\s\-]/g, ''))` + `.pipe(z.string().regex(/^\d{11}$/))` — normalise then strictly validate 11 digits.
- Timezone schema: `z.enum(AU_TIMEZONES)` allowlist — Australia/Sydney, Melbourne, Brisbane, Perth, Adelaide, Darwin, Hobart, Lord_Howe.
- `subscriptionTier` REMOVED from `updateClinicSchema`. `.strict()` now rejects any request body containing it, closing the client-side tier escalation vector.

### Task 4 — Temporal Drift / Timezone Calibration
**Files:** `forecastService.ts`, `laborForecastService.ts`
- `toLocalDateString(date, timezone)` — returns YYYY-MM-DD in clinic's IANA timezone (prevents midnight-crossing drift on UTC servers).
- `addCalendarDays(dateStr, n)` — UTC-based calendar-day arithmetic (DST-safe).
- `localDayStartUTC(dateStr, timezone)` — converts local midnight to UTC timestamp via `Intl.DateTimeFormat.formatToParts` without any external date library.
- Lookback/forecast windows anchored to clinic-local day boundaries.

**Files:** `forecastRoutes.ts`, `laborForecastRoutes.ts`
- Each handler fetches `clinic.timezone` from `clinicRepository.findById()` and passes it as `options.timezone` to the relevant service.

---

## Module 07 — Core Billing, Invoicing, and Multi-Tenant Payment Integrations

**Current Phase:** Module 07 Session 1 complete — Database Schema, BillingService, Multi-Tenant Guard

### Session 1 complete — Schema, Repositories, Service, Routes

#### New files
- [x] `src/types/billing.ts` — `INVOICE_STATUSES`, `LINE_ITEM_TYPES`, `PAYMENT_METHODS`, `PAYMENT_STATUSES` as `as const` arrays; `Invoice`, `InvoiceLineItem`, `PaymentRecord` domain types; `CreateInvoiceInput`, `AddLineItemInput`, `RecordPaymentInput`, `UpdateInvoiceInput`, `ListInvoiceOptions` input shapes; `GST_RATE_BASIS_POINTS = 1000`, `calculateTaxCents(subtotalCents, basisPoints)`
- [x] `src/repositories/billingRepository.ts` — `BillingRepository` interface + `createInMemoryBillingRepository()` factory
- [x] `src/repositories/billingRepository.postgres.ts` — Full Postgres implementation with row mappers; `nextInvoiceNumber` uses `invoice_number_sequences` table with `UPDATE ... RETURNING` for serialized increments
- [x] `src/services/billingService.ts` — `createBillingService(billingRepository)` factory with `assertTenantAccess`, `assertBillingWriteAccess`, `assertNotTerminal` guards; all operations: `createDraftInvoice`, `addLineItem`, `removeLineItem`, `issueInvoice`, `recordPayment`, `voidInvoice`, `getInvoice`, `listInvoices`, `listLineItems`, `listPayments`
- [x] `src/controllers/billingController.ts` — Zod-validated handlers; `.strict()` on all write schemas; `z.enum(LINE_ITEM_TYPES)`, `z.enum(PAYMENT_METHODS)` derive from type arrays
- [x] `src/routes/billingRoutes.ts` — Mounted at `/clinics/:clinicId/billing`; 10 routes covering invoice CRUD, lifecycle actions, line items, and payments
- [x] `tests/billingService.test.ts` — 28 tests covering all CRUD paths, GST calculations, RBAC, tenant guards, invoice lifecycle, payment/refund flows, and sequential numbering

#### Modified files
- [x] `src/db/migrate.ts` — `013_billing_schema` added: 4 ENUMs (`invoice_status`, `line_item_type`, `billing_payment_method`, `billing_payment_status`), 4 tables (`invoices`, `invoice_number_sequences`, `invoice_line_items`, `payment_records`), 7 indexes
- [x] `src/bootstrap/dependencies.ts` — `billingRepository` + `billingService` added to `AppDependencies`; both Postgres and in-memory paths wired
- [x] `src/routes/index.ts` — `/clinics/:clinicId/billing` mounted

#### Database schema: `013_billing_schema`

**Design principles (non-negotiable):**
| Principle | Implementation |
|-----------|----------------|
| Integer cents | All monetary fields are `integer` — no floats |
| GST snapshot | `tax_rate_basis_points` (default 1000 = 10%) stored at creation time |
| `clinic_id` everywhere | Present on `invoices`, `invoice_line_items`, AND `payment_records` |
| Defence-in-depth | Line items + payments carry redundant `clinic_id` — guessed invoice IDs cannot cross tenant boundaries |
| Append-only payments | No DELETE/UPDATE on `payment_records`; refunds = negative `amount_cents` rows |
| Draft invisibility | `invoice_number` is NULL until `issueInvoice()` is called |

**`invoices` table key columns:**
- `clinic_id` uuid NOT NULL FK → `clinics.id`
- `invoice_number` varchar(32) UNIQUE — NULL until issued
- `status` invoice_status ENUM — `draft` → `issued` → `paid | partially_paid | overdue` (terminal: `void | cancelled`)
- `subtotal_cents`, `tax_cents`, `discount_cents`, `total_cents`, `paid_cents`, `outstanding_cents` — all integer
- `tax_rate_basis_points` integer DEFAULT 1000

**`invoice_number_sequences`** — per-clinic atomic counter (PK: `clinic_id`)

**`invoice_line_items`** — `clinic_id` (redundant), `invoice_id` FK, `line_item_type` ENUM, `tax_rate_basis_points` (snapshot), `sort_order`

**`payment_records`** — `clinic_id` (redundant), `invoice_id` FK, `billing_payment_method` ENUM, `billing_payment_status` ENUM, `amount_cents` (positive = payment, negative = refund)

#### Multi-tenant guard architecture

The service-layer guard `assertTenantAccess(caller, clinicId)` is:
- **Explicit token-level:** checks `caller.homeClinicId === clinicId` at the start of every method
- **`owner_admin` bypass:** unrestricted cross-clinic access
- **Defence-in-depth:** runs IN ADDITION to `enforceTenantParam` middleware
- **Error code:** `BILLING_TENANT_VIOLATION` (403)

#### REST API surface (Session 1)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/clinics/:clinicId/billing/invoices` | All authenticated | enforceTenantParam + assertTenantAccess |
| `POST` | `/clinics/:clinicId/billing/invoices` | manager / admin | Creates draft invoice |
| `GET` | `/clinics/:clinicId/billing/invoices/:invoiceId` | All authenticated | Returns invoice + lineItems + payments |
| `PATCH` | `/clinics/:clinicId/billing/invoices/:invoiceId/issue` | manager / admin | draft → issued + invoiceNumber |
| `PATCH` | `/clinics/:clinicId/billing/invoices/:invoiceId/void` | manager / admin | Requires non-empty reason |
| `GET` | `/clinics/:clinicId/billing/invoices/:invoiceId/line-items` | All authenticated | |
| `POST` | `/clinics/:clinicId/billing/invoices/:invoiceId/line-items` | manager / admin | Only on draft invoices |
| `DELETE` | `/clinics/:clinicId/billing/invoices/:invoiceId/line-items/:lineItemId` | manager / admin | Only on draft invoices |
| `GET` | `/clinics/:clinicId/billing/invoices/:invoiceId/payments` | All authenticated | |
| `POST` | `/clinics/:clinicId/billing/invoices/:invoiceId/payments` | manager / admin | Positive = payment, negative = refund |

#### Tax calculation (GST 10%)
```
lineItem.subtotalCents = quantity × unitPriceCents
lineItem.taxCents      = Math.round(subtotalCents × taxRateBasisPoints / 10_000)
lineItem.totalCents    = subtotalCents + taxCents
invoice totals         = refreshInvoiceTotals() → sum of all line items
```

#### Payment status transitions
```
issued / partially_paid / overdue / paid → recordPayment()
  outstandingCents ≤ 0   → paid
  paidCents > 0 but > 0  → partially_paid
  (refund on paid)        → partially_paid (outstanding restored)
```

#### Test count
12 suites / 258 tests — all green, 0 TypeScript errors (Backend workspace)

#### Next steps for Module 07
- [ ] Session 2: Payment gateway integration scaffolding (Stripe / Tyro webhook handlers)
- [ ] Session 3: Invoice PDF generation + email dispatch
- [ ] Session 4: Overdue invoice scheduler (status → `overdue` on `due_at` expiry)
- [ ] Session 5: Xero / MYOB accounting adapter — invoice sync + payment reconciliation

---

## Module 08 — Analytics, Reporting, and Audit Trails

**Current Phase:** Session 1 IN PROGRESS — Structural foundations, scaffold, mock data

### Session 1 in progress — Structural scaffold complete

#### New files
- [x] `src/types/analytics.ts` — `AuditEntityType`, `AuditEvent`, `CreateAuditEventInput`, `ListAuditEventsOptions`, `AuditEventsPage`, `DashboardKpis`, `RevenueReport`, `InventoryReport`, `StaffReport` + all sub-shapes
- [x] `src/repositories/analyticsRepository.ts` — `AnalyticsRepository` interface + `createInMemoryAnalyticsRepository()` factory with 12 pre-seeded audit events across both clinics and 5 entity types
- [x] `src/repositories/analyticsRepository.postgres.ts` — Full Postgres implementation with parameterized filtering and COUNT query for pagination totals
- [x] `src/services/analyticsService.ts` — `createAnalyticsService()` factory; aggregates from billing/inventory/roster repos for KPIs; RBAC guard blocks `clinical_staff`
- [x] `src/controllers/analyticsController.ts` — Zod-validated query handlers with `firstString()` normalizer for Express ParsedQs; all 6 handlers
- [x] `src/routes/analyticsRoutes.ts` — 6 routes mounted at `/clinics/:clinicId/analytics`, all behind `managerOrAdmin` + `tenantGuard`

#### Modified files
- [x] `src/db/migrate.ts` — `014_analytics_audit_schema` added: `audit_events` table + 3 indexes (clinic+time, entity drill-down, actor drill-down)
- [x] `src/bootstrap/dependencies.ts` — `analyticsRepository` + `analyticsService` added to `AppDependencies`; both Postgres and in-memory paths wired
- [x] `src/routes/index.ts` — `/clinics/:clinicId/analytics` mounted (Module 08 comment)

#### REST API surface (Session 1)
| Method | Path | RBAC | Notes |
|--------|------|------|-------|
| `GET` | `/clinics/:clinicId/analytics/dashboard` | admin, manager | 30-day KPI summary (revenue, inventory, roster); `?periodDays=1-365` |
| `GET` | `/clinics/:clinicId/analytics/revenue` | admin, manager | Monthly revenue breakdown; `?months=1-24` |
| `GET` | `/clinics/:clinicId/analytics/inventory` | admin, manager | Inventory consumption; `?periodDays=1-365` |
| `GET` | `/clinics/:clinicId/analytics/staff` | admin, manager | Staff attendance rate; `?periodDays=1-365` |
| `GET` | `/clinics/:clinicId/analytics/audit-events` | admin, manager | Paginated audit trail; `?entityType=&actorId=&entityId=&from=&to=&limit=&offset=` |
| `GET` | `/clinics/:clinicId/analytics/audit-events/:eventId` | admin, manager | Single audit event detail |

#### Database: `014_analytics_audit_schema`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | gen_random_uuid() |
| `clinic_id` | uuid NOT NULL | Tenant anchor |
| `entity_type` | varchar(64) | invoice, payment, roster_entry, user, clinic, etc. |
| `entity_id` | uuid NOT NULL | ID of the affected entity |
| `action` | varchar(128) | created, updated, deleted, issued, void, scan_deduct, etc. |
| `actor_id` | uuid NOT NULL | User who performed the action |
| `actor_email` | varchar(255) | Denormalized for display without join |
| `metadata` | jsonb | Arbitrary structured context captured at event time |
| `created_at` | timestamptz | Append-only; never updated |

**Indexes:**
- `idx_audit_events_clinic_created` — `(clinic_id, created_at DESC)` — primary audit trail query
- `idx_audit_events_entity` — `(clinic_id, entity_type, entity_id, created_at DESC)` — entity drill-down
- `idx_audit_events_actor` — `(clinic_id, actor_id, created_at DESC)` — actor drill-down

#### Architecture notes
- Analytics KPIs are computed at query time by aggregating from billing/inventory/roster repos — no separate analytics materialized tables yet (suitable for current scale)
- Audit events are append-only (no UPDATE/DELETE); refund/undo events add new rows with inverse actions
- `recordAuditEvent()` is an internal service method — not a public REST endpoint
- `clinical_staff` role is blocked from all analytics + audit endpoints at both middleware and service layers (defence in depth)
- In-memory mode: 12 pre-seeded audit events across Clinic A (10) and Clinic B (2) covering user, roster, inventory, invoice, payment, leave, and clinic entity types

#### TypeScript status
0 TS errors in Backend workspace — **258/258 tests green**

---

## System Integration & Stabilization — COMPLETE ✓

**Delivered after Module 08 Session 1 lock-down.**

### Fix 1 — health.test.ts MFA assertion (pre-existing failure resolved)
- **Root cause:** `admin@clinic-a.au` in-memory seed had `mfaEnabled: false`; the test "requires MFA for owner/admin accounts with MFA enabled" was asserting `requiresMfa: true`.
- **Fix:** `src/repositories/userRepository.ts` — `mfaEnabled: true` for `clinicAAdmin` seed record.
- The `authService` MFA gate (`user.mfaEnabled && MFA_REQUIRED_ROLES.includes(user.role)`) now correctly triggers the MFA challenge for `owner_admin` in tests.

### Fix 2 — Cross-module audit event wiring
`recordAuditEvent()` is now automatically called (fire-and-forget) at all key business mutation points:

| Service | Actions audited | Entity type |
|---------|----------------|-------------|
| `BillingService` | `createDraftInvoice`, `issueInvoice`, `voidInvoice` | `invoice` |
| `BillingService` | `recordPayment` (payment or refund) | `payment` |
| `RosterService` | `createEntry`, `updateEntry` (incl. `completed`), `cancelEntry` | `roster_entry` |
| `InventoryService` | `adjustStock` | `inventory_adjustment` |

**Injection pattern:** Each service accepts an optional `AuditWriter` interface (narrow structural type — only `recordEvent`). This keeps the services decoupled from the full `AnalyticsRepository` and preserves backward compatibility with existing unit tests that don't supply an audit writer.

**Wiring:**
- `billingService` → `dependencies.ts` passes `analyticsRepository` as second arg
- `inventoryService` → `inventoryRoutes.ts` passes `deps.analyticsRepository`
- `rosterService` → `rosterRoutes.ts` passes `deps.analyticsRepository` as 5th arg (after `timesheetService` hook)

### Fix 3 — Analytics routes mounted
`src/routes/index.ts`: `createAnalyticsRouter` was imported but never mounted. Added:
```
router.use("/clinics/:clinicId/analytics", createAnalyticsRouter(deps));
```
All 6 analytics/audit endpoints are now live.

### Fix 4 — Postgres ↔ In-Memory mode verified
`dependencies.ts` switches all 9 repositories (users, catalog, clinic, inventory, roster, timesheet, leave, billing, analytics) between Postgres and in-memory implementations via the single `connectedPool` probe. The `analyticsRepository` (Module 08) follows the same dual-mode pattern.

#### Next steps for Module 08
- [ ] Session 2: Frontend analytics dashboard — KPI cards, revenue chart, staff attendance table
- [ ] Session 3: Audit event export (CSV download endpoint)
- [ ] Session 4: Cross-clinic aggregate reports for `owner_admin` (all-clinic revenue roll-up)

---

## MVP Hardening — Purchase Order Submit + CSV Export

**Completed:** June 2026 (post-Module 08 stabilization)
**Test count:** 13 suites / 278 tests green — 0 TypeScript errors

### What changed

#### New backend methods (`InventoryRepository` interface + both implementations)
| Method | Description |
|--------|-------------|
| `listPurchaseOrders(clinicId)` | Returns all POs for a clinic (any status) |
| `findPurchaseOrderById(clinicId, poId)` | Tenant-safe PO lookup |
| `submitPurchaseOrder(clinicId, poId)` | Transitions `draft → submitted`; throws `Error` (not AppError) for not-found or already-submitted so the controller can wrap with correct HTTP codes |

Both `inventoryRepository.ts` (in-memory) and `inventoryRepository.postgres.ts` implement all three methods. The Postgres `submitPurchaseOrder` uses a conditional `UPDATE ... WHERE status = 'draft'` then a follow-up read to distinguish 404 vs 409.

#### Updated `purchaseOrderController.ts`
- `listPurchaseOrders` — now fetches all POs in parallel with lines, builds a `poStatusMap`, and returns enriched lines with real `orderStatus` (was hardcoded `"draft"` before).
- `submitPurchaseOrder` — Zod `.strict()` schema with optional `supplierNote`; wraps repository errors into `AppError(404, "PO_NOT_FOUND")` or `AppError(409, "PO_ALREADY_SUBMITTED")`.
- `exportPurchaseOrdersCsv` — RFC 4180 CSV with double-quoting; `Content-Disposition: attachment` response; filename includes clinicId + ISO date.

#### Updated `purchaseOrderRoutes.ts`
| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/clinics/:clinicId/purchase-orders` | Existing — now returns real status |
| `GET` | `/clinics/:clinicId/purchase-orders/export.csv` | **New** — literal path mounted before `/:poId` |
| `PATCH` | `/clinics/:clinicId/purchase-orders/:poId/submit` | **New** — draft → submitted transition |

All three routes are behind `authenticate + enforceTenantParam + requireRoles(owner_admin, group_practice_manager)`.

#### New test file `Backend/tests/purchaseOrderApi.test.ts` (20 tests)
- List: empty array, enriched lines with draft status, RBAC denial, tenant isolation, admin access, 401 without token
- Submit: happy path, status reflected in list, 409 double-submit, 404 unknown PO, .strict() extra-field rejection, optional supplierNote, staff RBAC denial, new-PO-after-submission flow
- Export: correct Content-Type/Content-Disposition, header row, data row content, empty-CSV (header only), submitted lines included, staff denial

#### Frontend `PurchaseOrdersPage.tsx`
- Status badge now colour-coded (amber = draft, green = submitted)
- "Submit PO" button per row (draft lines only); disabled while submitting that PO ID
- Batch "Submit draft PO (N lines)" button appears below the table when draft POs exist
- "Export CSV" button triggers browser download via `exportPurchaseOrdersCsv(clinicId)`
- Summary stats split into Draft lines / Submitted lines
- `submitError` and `exportError` banners with `role="alert"`

#### Frontend `api/client.ts`
- `submitPurchaseOrder(clinicId, poId, supplierNote?)` — `PATCH` with optional body
- `exportPurchaseOrdersCsv(clinicId)` — fetches CSV, creates object URL, programmatically triggers download anchor, cleans up

#### Frontend `index.css`
- `.po-batch-actions` — flex row for batch submit buttons
- `.po-submit-btn` — smaller font for inline row actions
- `.button-primary` — blue primary action button (reusable across modules)

### Architectural decisions
- **No new migration needed** — `draft_purchase_orders.status` was already `draft_po_status ENUM ('draft', 'submitted')` from the Module 03 inventory schema (`005_inventory_schema`). The submit endpoint simply updates the existing column.
- **Existing auto-draft PO behavior preserved** — `ScanService.handleScan` continues to call `findOrCreateDraftPo()` which creates a new draft if no draft PO exists for the clinic (post-submission).
- **CSV exported on client side** — No streaming/server-side file storage required; blob URL download is appropriate for typical PO list sizes.

### Remaining gaps
- [ ] Supplier email / EDI integration (sending the submitted PO to the actual supplier)
- [ ] PO line editing (adjust quantity before submit)
- [ ] PO line deletion / cancellation after submit
- [ ] Receiving workflow (mark PO as received, auto-increment stock)
