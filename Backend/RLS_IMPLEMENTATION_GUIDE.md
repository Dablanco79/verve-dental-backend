# RLS Implementation Guide — Verve Dental Operational Suite

**Module:** 13 — Database Row-Level Security  
**Date:** June 2026  
**Author:** Principal Security Architect / Senior PostgreSQL Engineer  
**Status:** Implemented and integrated

---

## 1. Architecture Overview

### 1.1 Defence-in-Depth Model

Tenant isolation is enforced at three independent layers:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — JWT + RBAC (Express middleware)                  │
│  enforceTenantParam: URL clinicId === JWT.homeClinicId       │
│  requireRoles: role-based access control per route          │
├─────────────────────────────────────────────────────────────┤
│  Layer 2 — Application-layer filtering (repositories)       │
│  Every query: WHERE clinic_id = $1 (parameterised)          │
│  Service guards: assertTenantAccess(), assertReadAccess()   │
├─────────────────────────────────────────────────────────────┤
│  Layer 3 — PostgreSQL RLS (database engine)  ← NEW          │
│  ENABLE ROW LEVEL SECURITY on 14 tables                     │
│  Policies: clinic_id = app_current_clinic_id()              │
│  FORCE ROW LEVEL SECURITY: applies to table owner role      │
└─────────────────────────────────────────────────────────────┘
```

**Key property:** Layer 3 operates independently of the application. If layers 1 and 2 both fail (e.g., a bug omits the WHERE clause), the database engine still rejects cross-tenant row access.

### 1.2 Session Variables

Two PostgreSQL session variables govern RLS policy evaluation:

| Variable | Type | Purpose |
|----------|------|---------|
| `app.current_clinic_id` | `uuid` string | Restricts row access to rows with a matching `clinic_id`. Empty string = NULL context. |
| `app.owner_admin_mode` | `'true'` / `'false'` | When `'true'`, all RLS policies are bypassed (owner_admin cross-clinic access). |

Both variables are read by the helper functions:
- `app_current_clinic_id()` → `uuid | NULL`
- `app_is_owner_admin()` → `boolean`

These functions are `STABLE SECURITY DEFINER` so they can safely be called from RLS policy expressions.

---

## 2. Tables Protected

### 2.1 Directly protected (14 tables)

| Table | Migration | Tenant Column | Policy |
|-------|-----------|---------------|--------|
| `users` | 003 | `home_clinic_id` | `= app_current_clinic_id()` OR context IS NULL (auth bypass) |
| `clinic_inventory_items` | 005 | `clinic_id` | `= app_current_clinic_id()` |
| `inventory_adjustments` | 005 | `clinic_id` | `= app_current_clinic_id()` |
| `draft_purchase_orders` | 005 | `clinic_id` | `= app_current_clinic_id()` |
| `draft_po_lines` | 005 | (FK via parent) | EXISTS subquery to `draft_purchase_orders.clinic_id` |
| `roster_entries` | 006 | `rostered_clinic_id` | `= app_current_clinic_id()` |
| `roster_entry_audit` | 006 | (FK via parent) | EXISTS subquery to `roster_entries.rostered_clinic_id` |
| `timesheet_entries` | 008 | `clinic_id` | `= app_current_clinic_id()` |
| `leave_requests` | 008 | `clinic_id` | `= app_current_clinic_id()` |
| `invoices` | 013 | `clinic_id` | `= app_current_clinic_id()` |
| `invoice_number_sequences` | 013 | `clinic_id` | `= app_current_clinic_id()` |
| `invoice_line_items` | 013 | `clinic_id` | `= app_current_clinic_id()` |
| `payment_records` | 013 | `clinic_id` | `= app_current_clinic_id()` |
| `audit_events` | 014 | `clinic_id` | `= app_current_clinic_id()` |

### 2.2 Excluded tables (global / shared)

| Table | Reason |
|-------|--------|
| `schema_migrations` | Internal. No tenant data. |
| `master_catalog_items` | Global product catalog. All clinics read the same rows. |
| `barcode_mappings` | Global barcode ↔ SKU mappings. |
| `clinics` | The tenant registry itself. Protected by application-layer RBAC. |

---

## 3. Application Integration

### 3.1 `withTenantContext()` — Explicit scoping

For operations requiring an explicit, transaction-scoped tenant context:

```typescript
import { withTenantContext } from "../db/tenantContext.js";

// Returns ONLY Clinic A's invoices — RLS enforced at DB level
const { rows } = await withTenantContext(pool, clinicAId, async (client) => {
  return client.query("SELECT * FROM invoices"); // no WHERE clause needed
});

// owner_admin cross-clinic access
const { rows } = await withTenantContext(pool, clinicBId, async (client) => {
  return client.query("SELECT * FROM invoices");
}, true /* ownerAdmin */);
```

**Implementation:** Uses `BEGIN` + `set_config('app.current_clinic_id', clinicId, true)` (transaction-local). Context is automatically cleared on `COMMIT` / `ROLLBACK`. No connection-pool leakage risk.

### 3.2 `installRlsPoolHook()` — Transparent injection

Called once at application startup (after migrations):

```typescript
// In createAppDependencies(), after migrations:
installRlsPoolHook(connectedPool);
```

This installs an `AsyncLocalStorage`-based hook that:
1. Intercepts `pool.connect()`.
2. When a request context is active (`tenantStorage.getStore()`), injects the session variables on every checked-out connection.
3. Wraps `client.release()` to reset the variables to `''` before returning to the pool.

### 3.3 `rlsTenantContextMiddleware()` — Per-request activation

Registered on all `/clinics/:clinicId` routes:

```typescript
router.use("/clinics/:clinicId", authenticate, rlsTenantContextMiddleware(pool));
```

This middleware:
1. Extracts `clinicId` from `req.params.clinicId` (or falls back to `req.user.homeClinicId`).
2. Sets `ownerAdmin: true` when `req.user.role === 'owner_admin'`.
3. Runs `next()` **inside** an `AsyncLocalStorage.run()` call, so all downstream async code inherits the context.
4. Because `installRlsPoolHook` intercepts `pool.connect()`, every repository query in the request automatically uses the correct tenant context.

**No modifications required to existing repositories.**

---

## 4. Connection Pool Behaviour and Safety

### 4.1 Session variable lifecycle

```
Request arrives
  → authenticate middleware (sets req.user)
  → rlsTenantContextMiddleware (sets AsyncLocalStorage context)
  
Repository calls pool.query() (internally calls pool.connect())
  → installRlsPoolHook intercepts connect()
  → set_config('app.current_clinic_id', clinicId, false)   ← session-level
  → set_config('app.owner_admin_mode', 'true'/'false', false)
  → original query executes (RLS context active)
  → client.release() is called
     → reset both vars to '' before returning to pool
     → original release() called
```

### 4.2 Why `set_config(local = false)` is safe here

The connection's session variable is set at checkout and reset at release. This means:
- A connection cannot carry stale context from one request to the next.
- Unlike `SET LOCAL`, this does NOT require an explicit transaction per query.
- The reset-on-release wrapper is deterministic and synchronous within the async chain.

### 4.3 Upgrade path to strict transaction-local mode

For environments requiring full ACID isolation of the tenant context (e.g., production with read replicas), use `withTenantContext()` directly in service methods:

```typescript
// In billingService.ts — createDraftInvoice():
return withTenantContext(pool, clinicId, async (client) => {
  return client.query(`INSERT INTO invoices ...`);
});
```

This uses `set_config(local = true)` which is transaction-scoped and absolutely cannot leak between requests regardless of pool behaviour.

---

## 5. Role Access Patterns

### 5.1 Standard staff and managers

```
JWT.homeClinicId = 'clinic-a-uuid'
req.params.clinicId = 'clinic-a-uuid'
→ rlsTenantContextMiddleware sets: { clinicId: 'clinic-a-uuid', ownerAdmin: false }
→ installRlsPoolHook calls: set_config('app.current_clinic_id', 'clinic-a-uuid', false)
→ RLS allows: clinic_id = 'clinic-a-uuid'
→ RLS rejects: clinic_id = 'clinic-b-uuid'
```

### 5.2 Owner admin (cross-clinic)

```
JWT.role = 'owner_admin'
req.params.clinicId = 'clinic-b-uuid'  (accessing Clinic B data)
→ rlsTenantContextMiddleware sets: { clinicId: 'clinic-b-uuid', ownerAdmin: true }
→ installRlsPoolHook calls: set_config('app.owner_admin_mode', 'true', false)
→ RLS policy: app_is_owner_admin() = true → ALL rows visible
```

### 5.3 Auth operations (no clinic context)

```
POST /auth/login (no JWT, no clinicId)
→ rlsTenantContextMiddleware: req.user is null → next() without context
→ installRlsPoolHook: no context in AsyncLocalStorage → connect() unchanged
→ app.current_clinic_id not set (NULL)
→ users table policy: app_current_clinic_id() IS NULL → SELECT allowed
→ Other tenant tables: clinic_id = NULL → 0 rows returned (correct)
```

---

## 6. Migration Strategy

### 6.1 Applying migration 015

Migration 015 is included in `BOOTSTRAP_MIGRATIONS` in `src/db/migrate.ts`. It runs automatically on cold start via `runBootstrapMigrations()`.

The migration is fully idempotent:
- `CREATE OR REPLACE FUNCTION` — safe to re-run.
- `DROP POLICY IF EXISTS` + `CREATE POLICY` — safe to re-run.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — idempotent in PostgreSQL.

**No downtime required.** The migration can be applied to a live database because:
- `ENABLE ROW LEVEL SECURITY` without any policies = no rows rejected (policies are additive).
- The advisory lock in `runBootstrapMigrations` prevents concurrent migration runs.

### 6.2 Order dependency

Migration 015 references all tables created in migrations 003–014. It MUST run after all of them. The `BOOTSTRAP_MIGRATIONS` array maintains this order.

### 6.3 Existing data

No data backfill is required. All existing rows already have `clinic_id` populated (enforced by `NOT NULL` constraints added in earlier migrations).

---

## 7. Rollback Plan

### 7.1 Immediate rollback (< 2 minutes)

```sql
-- Execute 015_rls_policies.down.sql:
\i Backend/migrations/015_rls_policies.down.sql
```

This:
1. Drops all 17 RLS policies.
2. Disables RLS on all 14 tables.
3. Drops `app_current_clinic_id()` and `app_is_owner_admin()`.

After rollback, tenant isolation returns to application-layer-only (the pre-015 state).

### 7.2 Partial rollback (specific table)

To disable RLS on a single table without affecting others:

```sql
ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_invoices_tenant ON invoices;
```

### 7.3 Re-applying after rollback

Re-run the bootstrap migrations on the next application startup, or execute:
```sql
\i Backend/migrations/015_rls_policies.up.sql
```

### 7.4 Application code rollback

To revert the application integration (pool hook + middleware):
1. Remove `installRlsPoolHook(connectedPool)` call from `dependencies.ts`.
2. Remove `router.use("/clinics/:clinicId", authenticate, rlsContext)` from `routes/index.ts`.
3. The repositories continue working unchanged (they always have `WHERE clinic_id = $1`).

---

## 8. Security Testing Evidence

Security tests are in `Backend/src/repositories/__tests__/rlsIsolation.test.ts`.

**Test matrix:**

| Test | Assertion | Proves |
|------|-----------|--------|
| Clinic A cannot read Clinic B inventory | 0 rows returned | DB rejects cross-tenant inventory access |
| Clinic A cannot read Clinic B purchase orders | 0 rows returned | DB rejects cross-tenant PO access |
| Clinic A cannot read Clinic B timesheets | 0 rows returned | DB rejects cross-tenant payroll access |
| Clinic A cannot read Clinic B billing data | 0 rows returned | DB rejects cross-tenant billing access |
| Clinic A cannot read Clinic B leave requests | 0 rows returned | DB rejects cross-tenant leave access |
| Clinic A cannot read Clinic B audit events | 0 rows returned | DB rejects cross-tenant audit access |
| Unfiltered query: only own clinic rows visible | rows.every(r => r.clinic_id === ownClinic) | No WHERE clause needed for isolation |
| owner_admin can read cross-clinic | rows.length = 2 | Bypass works correctly |
| Empty context: 0 rows from any tenant table | 0 rows | Unauthenticated sessions see nothing |

**Running the tests:**

```bash
# Requires DATABASE_URL with migration 015 applied
cd Backend
DATABASE_URL=postgres://... npx jest rlsIsolation --testPathPattern=rlsIsolation
```

Tests automatically skip when `DATABASE_URL` is not set, so the CI pipeline runs them only on environments with a real PostgreSQL instance.

---

## 9. Known Limitations and Future Work

### 9.1 Connection pool — session-level vs transaction-level

The `installRlsPoolHook` uses `set_config(local = false)` (session-level). The reset-on-release wrapper provides equivalent safety in practice, but does not guarantee ACID-level transaction isolation of the tenant context.

**Recommendation for production hardening:** Migrate hot paths to `withTenantContext()` which uses `set_config(local = true)` inside an explicit transaction.

### 9.2 `users` table NULL-context bypass

The `users` table policy includes `OR app_current_clinic_id() IS NULL` to permit auth email-lookups before login. This means a session with no context set can read all user rows.

**Risk:** Low — the `users` endpoint still requires a valid JWT (auth middleware enforces this). Direct DB access as `app_user` role would also be required to exploit this.

**Future:** Create a dedicated `app_auth_user` database role for auth operations, remove the NULL bypass, and connect auth queries as `app_auth_user` instead.

### 9.3 `draft_po_lines` and `roster_entry_audit` — EXISTS subquery overhead

These tables use EXISTS subqueries in their RLS policies (no direct `clinic_id`). This adds a join per row during policy evaluation.

**Recommendation:** Add a redundant `clinic_id` column to both tables (with a migration) and switch to the direct equality check for improved performance at scale.

### 9.4 PostgreSQL superuser

The PostgreSQL superuser role always bypasses RLS, regardless of `FORCE ROW LEVEL SECURITY`. Migrations and DBA operations run as superuser are unaffected.

**Recommendation:** Ensure the application's `DATABASE_URL` credentials connect as a non-superuser role. The superuser account should only be used for migrations.

---

## 10. Files Changed

| File | Change |
|------|--------|
| `Backend/migrations/015_rls_policies.up.sql` | **NEW** — Full RLS migration (14 tables, 2 helper functions, 17 policies) |
| `Backend/migrations/015_rls_policies.down.sql` | **NEW** — Rollback script |
| `Backend/src/db/migrate.ts` | Added `015_rls_policies` to `BOOTSTRAP_MIGRATIONS` |
| `Backend/src/db/tenantContext.ts` | **REWRITTEN** — Added `withTenantContext`, `installRlsPoolHook`, `rlsTenantContextMiddleware`, `getCurrentTenantCtx` |
| `Backend/src/bootstrap/dependencies.ts` | Added `installRlsPoolHook(connectedPool)` call after migrations |
| `Backend/src/routes/index.ts` | Added global `router.use("/clinics/:clinicId", authenticate, rlsContext)` |
| `Backend/src/middleware/authMiddleware.ts` | Added early-return when `req.user` already set (double-authenticate optimisation) |
| `Backend/src/repositories/__tests__/rlsIsolation.test.ts` | **NEW** — 18 RLS isolation integration tests |
| `Backend/RLS_AUDIT_REPORT.md` | **NEW** — Comprehensive table audit |
| `Backend/RLS_IMPLEMENTATION_GUIDE.md` | **NEW** — This document |

---

## 11. Tables Protected Summary

| # | Table | RLS Enabled | Policy Count |
|---|-------|-------------|-------------|
| 1 | `users` | ✅ FORCE | 4 (SELECT / INSERT / UPDATE / DELETE) |
| 2 | `clinic_inventory_items` | ✅ FORCE | 1 (ALL) |
| 3 | `inventory_adjustments` | ✅ FORCE | 1 (ALL) |
| 4 | `draft_purchase_orders` | ✅ FORCE | 1 (ALL) |
| 5 | `draft_po_lines` | ✅ FORCE | 1 (ALL, EXISTS subquery) |
| 6 | `roster_entries` | ✅ FORCE | 1 (ALL) |
| 7 | `roster_entry_audit` | ✅ FORCE | 1 (ALL, EXISTS subquery) |
| 8 | `timesheet_entries` | ✅ FORCE | 1 (ALL) |
| 9 | `leave_requests` | ✅ FORCE | 1 (ALL) |
| 10 | `invoices` | ✅ FORCE | 1 (ALL) |
| 11 | `invoice_number_sequences` | ✅ FORCE | 1 (ALL) |
| 12 | `invoice_line_items` | ✅ FORCE | 1 (ALL) |
| 13 | `payment_records` | ✅ FORCE | 1 (ALL) |
| 14 | `audit_events` | ✅ FORCE | 1 (ALL) |

**Total: 14 tables / 17 policies**
