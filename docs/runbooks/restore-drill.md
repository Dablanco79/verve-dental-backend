# Runbook: Restore Drill & Recovery Verification

**Service:** Verve Operational Suite — Full Stack  
**Severity:** P1 — Critical (disaster recovery exercise)  
**Sprint:** K.1 — Restore Drill & Recovery Verification  
**Release:** Post Sprint O.2  
**Created:** 2026-06-20  
**Last reviewed:** 2026-10-13
**Status:** DRAFT — provider procedure and restore capability unverified

> The plan tier, backup existence, schedule, retention, restore interface,
> duration, RPO, RTO, PITR, and regional isolation have not been verified.
> Historical provider-specific statements and estimates below are not release
> evidence and must not be treated as executable instructions until reconciled
> with current provider documentation. Update this runbook with dated evidence
> during the first isolated drill. Production readiness remains unproven.

---

## Table of Contents

1. [Part A — Document Review Findings](#part-a--document-review-findings)
2. [Part B — Restore Drill Procedure](#part-b--restore-drill-procedure)
3. [Part C — Recovery Verification Checklist](#part-c--recovery-verification-checklist)
4. [Part D — Secrets Recovery](#part-d--secrets-recovery)
5. [Part E — Pilot Recovery Targets](#part-e--pilot-recovery-targets)
6. [Part F — Render Readiness Review](#part-f--render-readiness-review)
7. [Part G — Restore Drill Sign-Off Template](#part-g--restore-drill-sign-off-template)
8. [Part H — Pilot Go / No-Go Criteria](#part-h--pilot-go--no-go-criteria)
9. [Part I — Remaining Risks](#part-i--remaining-risks)

---

## Part A — Document Review Findings

Part A records the historical 2026-06-20 review. Several listed documentation
defects were corrected on 2026-10-13; it is not a current defect register. The
open issue is to validate the revised procedures in a hosted drill.

### A.1 Documents reviewed

| Document | Last reviewed | Status |
|----------|--------------|--------|
| `docs/runbooks/backup-restore.md` | 2026-06-19 | Issues found — see below |
| `docs/runbooks/database-down.md` | 2026-06-18 | Minor issues found |
| `docs/runbooks/redis-down.md` | 2026-06-18 | Acceptable |
| `docs/runbooks/deployment-failure.md` | 2026-06-18 | Acceptable |

---

### A.2 Missing recovery steps

| Gap | Location | Detail |
|-----|----------|--------|
| **Supplier and supplier catalogue tables not verified post-restore** | `backup-restore.md` §3.3, §7 | Sprint O added migrations `017_suppliers_schema` and `018_supplier_catalogue_schema`. The verification queries and checklist do not include `suppliers` or `supplier_catalogue` tables. A restore could silently lose supplier data without detection. |
| **MFA enrollment not tested post-restore** | `backup-restore.md` §7 | The end-to-end smoke test only verifies login and token refresh. MFA-enrolled users require the original `MFA_ENCRYPTION_KEY` to decrypt stored TOTP secrets — this is not validated in any current post-restore step. |
| **Forecast and procurement endpoints not verified post-restore** | `backup-restore.md` §7 | No post-restore verification for `/api/v1/forecast/*`, `/api/v1/procurement/*`, or `/api/v1/suppliers/*`. These routes depend on tables introduced in later migrations. |
| **No rollback path documented for mid-restore failure** | `backup-restore.md` §3 | If a restore fails after `DATABASE_URL` has been updated in Render but before the backend comes up healthy, there is no documented step to revert to the pre-restore database. |
| **Migration count is stale** | `backup-restore.md` §1.4, §3.3 | The document states "15 migrations (003 through 016)" but Sprint O added `017_suppliers_schema` and `018_supplier_catalogue_schema`, making the total **16 migrations** (003 through 018). Post-restore verification checks for 15 would give a false pass. |

---

### A.3 Ambiguous instructions

| Issue | Location | Detail |
|-------|----------|--------|
| **Incorrect table name: `inventory_items`** | `backup-restore.md` §3.3 row-count query | The query selects `FROM inventory_items` — the correct table name is `clinic_inventory_items`. A direct `psql` execution would fail silently or return an error that could be misread as a restore problem. |
| **Incorrect table name: `roster_shifts`** | `backup-restore.md` §3.3 row-count query | The query selects `FROM roster_shifts` — the correct table name is `roster_entries`. |
| **No concrete Render service IDs documented** | `backup-restore.md` §3.4, §5 | Steps refer to `verve-dental-api` and `verve-dental-frontend` as placeholder names but do not confirm the actual Render service IDs/names. If these differ in the dashboard, operators will be confused. |
| **"Secure location" for pg_dump archive is undefined** | `backup-restore.md` §3.5 | Instructs operator to "Store the .dump file in a secure location" but provides no definition of what that location is (S3 bucket, encrypted local drive, password manager attachment). |
| **Migration execution needed correction** | `backup-restore.md` §3.4 | Keep `MIGRATE_ON_STARTUP=false`; apply migrations through the separate standalone CLI process and require a successful repeat with zero pending migrations. |

---

### A.4 Undocumented assumptions

| Assumption | Detail |
|-----------|--------|
| **Render Owner/Admin access is available** | All restore procedures require dashboard access with Owner or Admin role. The document does not identify who holds this role or what happens if they are unavailable. |
| **More than one person can access Render** | If the Render account owner is the sole operator and is unavailable (illness, departure), recovery is blocked. |
| **Secrets are accessible at time of incident** | There is no documented out-of-band secrets store. If the Render dashboard is unavailable (account lockout, provider outage), all secrets are inaccessible. |
| **DATABASE_URL changes after every restore** | A restored database gets a new Render hostname. Operators must know to update the environment variable — this is mentioned but the consequences of forgetting (app connects to old/possibly-deleted DB) are not spelled out. |
| **NODE_ENV is correct in the restored environment** | If restoring to a new Render service, `NODE_ENV=production` must be explicitly confirmed. Defaulting to `development` would cause the migration gate to not fire and RLS would behave differently. |

---

### A.5 Pilot risks identified

| Risk | Severity | Detail |
|------|----------|--------|
| No restore drill ever performed | **CRITICAL** | No one has verified that Render's daily snapshots actually produce a restorable database. The first restore attempt may occur during a real incident. |
| `MFA_ENCRYPTION_KEY` has no documented backup location | **CRITICAL** | Loss of this key locks out all MFA-enrolled users permanently. No recovery path exists without the original key. |
| Migration count is stale (15 vs 16) | **HIGH** | Post-restore checks that pass at "15 migrations" will give false confidence. Suppliers/catalogue data could be missing. |
| Render free tier auto-suspension risk | **HIGH** | If the database is on the free tier, it will suspend after 90 days of inactivity and be deleted after 6 months, destroying all backups. |
| No secondary Render account holder documented | **HIGH** | Single point of failure for all recovery operations. |

---

### A.6 Free-tier limitations

| Limitation | Impact |
|-----------|--------|
| Daily snapshots only (no PITR) | Up to 24 hours of data loss |
| 7-day backup retention | Cannot restore to a point more than 7 days ago |
| Auto-suspend after 90 days inactivity | Database may be unavailable when needed |
| Database deletion after 6 months | All data and backups permanently lost |
| No manual backup trigger | Cannot take a snapshot before a risky migration |
| No CLI or API restore | Dashboard access required — browser + credentials |
| No cross-region backup | Regional AWS outage destroys primary and backup simultaneously |

---

### A.7 Render-specific constraints

| Constraint | Detail |
|-----------|--------|
| Dashboard-only restore | No `render` CLI support for managed PostgreSQL restore |
| New database URL on every restore | Every restore to a new instance generates a new hostname — `DATABASE_URL` must be manually updated |
| No read replica or standby | Full outage during any restore operation |
| Restore duration is 15–45 minutes | Cannot be accelerated by operator action |
| Service re-creation changes public URL | If the API service itself is deleted and recreated, the `onrender.com` subdomain changes, requiring frontend env var updates |

---

## Part B — Restore Drill Procedure

> **SCOPE:** This section documents the complete procedure for performing a restore drill against a **non-production restore target** (a new Render PostgreSQL instance). No live production data is to be modified during a drill.

---

### B.1 Pre-drill checks

Before initiating any restore activity, complete all pre-drill checks. A single failed check should pause the drill.

#### B.1.1 Identify backup source

```
MANUAL OPERATOR ACTION REQUIRED

□ Log in to https://dashboard.render.com
□ Navigate to: PostgreSQL → <verve-production-database-instance>
□ Click "Backups" in the left-hand nav
□ Confirm at least one snapshot exists within the last 24 hours
□ Note the snapshot timestamp, size, and status
□ Record: BACKUP_SNAPSHOT_ID = <snapshot label / timestamp>
□ Record: BACKUP_SNAPSHOT_AGE = <hours since snapshot>
□ ABORT if no snapshot exists within the last 48 hours
```

#### B.1.2 Identify restore target

```
□ Confirm the drill target is a NEW database instance (not production)
□ Confirm the drill target environment has:
    - Sufficient storage for the restored database
    - A new Render service name: verve-db-drill-YYYYMMDD
□ Confirm the drill is NOT being performed on:
    - The live production DATABASE_URL
    - Any service currently receiving clinic staff traffic
```

#### B.1.3 Identify rollback path

```
□ Record current production DATABASE_URL (before any changes):
    PRODUCTION_DATABASE_URL = <copy from Render env dashboard>
□ Confirm this URL is stored securely outside the drill process
□ Confirm the intended environment and record:
    PRODUCTION_API_BASE_URL = <current Production API origin>
    DRILL_API_BASE_URL      = <isolated drill API origin>
    DRILL_FRONTEND_ORIGIN   = <isolated drill frontend HTTPS origin>
□ Confirm the production backend service is healthy:
    curl <PRODUCTION_API_BASE_URL>/api/v1/ready
    Expected: { "status": "ok" }
□ Confirm rollback path: if drill restore fails, production DATABASE_URL
  is NOT changed — production continues uninterrupted
```

#### B.1.4 Verify secrets availability

```
□ Confirm the original Production MFA_ENCRYPTION_KEY is accessible only if
  restored MFA data must be decrypted (confirm existence; never print it)
□ Generate or retrieve separate drill-only JWT access and refresh secrets
□ Confirm an isolated drill cache/session store is available
□ Confirm the drill will never use Production refresh-token storage
□ Confirm a test admin account exists with known credentials for post-restore smoke test
□ ABORT if any secret cannot be located
```

The original `MFA_ENCRYPTION_KEY` may be required to decrypt restored TOTP
secrets. Treat it as a Production secret even during a drill: inject it only
through the approved secret mechanism, never print or commit it, and remove it
from the drill service after testing.

#### B.1.5 Verify migration state

```
□ Derive the expected ordered migration IDs from the exact release SHA
□ Confirm the most recently applied migration in production:
    MANUAL OPERATOR ACTION REQUIRED
    psql "$PRODUCTION_DATABASE_URL" -c \
      "SELECT id, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 3;"
    Expected IDs: derive from the exact reviewed release SHA
```

#### B.1.6 Verify environment variables

```
□ Configure the isolated drill service environment:
    NODE_ENV                = production
    PORT                    = (Render-injected — do not override)
    HOST                    = 0.0.0.0
    DATABASE_URL            = <isolated restored database URL>
    DATABASE_SSL            = auto
    REDIS_URL               = <isolated drill cache URL>
    REDIS_TLS               = auto
    JWT_ACCESS_SECRET       = <separate drill-only secret, ≥32 chars>
    JWT_REFRESH_SECRET      = <separate drill-only secret, ≥32 chars>
    JWT_ACCESS_EXPIRES_IN   = 15m
    JWT_REFRESH_EXPIRES_IN  = 7d
    MFA_ENCRYPTION_KEY      = <original key only when MFA restore testing requires it>
    CORS_ORIGIN             = <DRILL_FRONTEND_ORIGIN>
    MIGRATE_ON_STARTUP      = false
□ Confirm each variable is accessible in the Render dashboard
□ Record which variables will need updating if drill connects a test service
□ Confirm DRILL_API_BASE_URL and CORS_ORIGIN identify only the drill environment
```

#### B.1.7 Isolate outbound integrations

Review the exact release SHA for every outbound integration before starting a
drill. Current source includes Anthropic OCR through `ANTHROPIC_API_KEY`.
Disable provider egress and OCR acceptance activity where possible. If startup
requires a provider credential, use a dedicated restricted non-Production
credential and ensure requests cannot affect Production accounts, billing,
webhooks, email, supplier systems, or other external destinations. Never copy a
Production integration credential into the drill environment. Stop if an
integration cannot be safely disabled or isolated.

---

### B.2 Restore process

#### B.2.1 Step-by-step restore procedure

```
MANUAL OPERATOR ACTION REQUIRED

Step 1 — Initiate the snapshot restore
────────────────────────────────────────
1. Log in to https://dashboard.render.com
2. Navigate to: PostgreSQL → <verve-production-database-instance>
3. Click "Backups" in the left-hand navigation panel
4. Identify the target snapshot (confirmed in B.1.1)
5. Click "Restore" on that snapshot
6. SELECT: Restore to a NEW database instance
   ⚠️  DO NOT select "Restore in place" — this overwrites production data
7. Name the new instance: verve-db-drill-YYYYMMDD
   (Replace YYYYMMDD with today's date, e.g. verve-db-drill-20260620)
8. Click "Confirm"
9. Record: RESTORE_START_TIME = <HH:MM UTC>

Step 2 — Wait for restore to complete
──────────────────────────────────────
1. Monitor the new database instance status in the Render dashboard
2. Status will transition: Creating → Restoring → Available
3. Typical duration: 15–45 minutes depending on database size
4. Do NOT proceed until status reads "Available"
5. Record: RESTORE_COMPLETE_TIME = <HH:MM UTC>
6. Record: RESTORE_DURATION_MINUTES = <COMPLETE - START>

Step 3 — Extract the restored database URL
───────────────────────────────────────────
1. In the new instance (verve-db-drill-YYYYMMDD), click "Connect"
2. Copy the "External Database URL": postgresql://...
3. Save as: RESTORED_DATABASE_URL (for verification steps below)
4. ⚠️  This URL contains credentials — do not share or log it
```

#### B.2.2 Render-specific notes

- Render restores create a **brand-new PostgreSQL instance** at a new hostname.
- The restored instance is **fully independent** — it will not receive future WAL logs from production.
- If the restored database is on the free tier, apply the same inactivity suspension caution.
- Render does not support PITR on free/starter plans — the restore reflects a full daily snapshot, not a point-in-time state.
- If the restore dashboard shows an error, contact Render Support immediately: https://render.com/support

#### B.2.3 PostgreSQL-specific notes

- The restored database is a full volume snapshot — all tables, indexes, sequences, functions, and RLS policies are included.
- RLS policies and helper functions (`app_current_clinic_id`, `app_is_owner_admin`) are part of the schema and will be present in the restore.
- ENUM types are included in the restore — no re-creation is needed.
- Keep `MIGRATE_ON_STARTUP=false`. From repository root, run
  `npm.cmd run migrate --workspace=@verve/backend` as a separate CLI process,
  require exit code 0, then repeat and confirm zero pending migrations.

#### B.2.4 Recovery decision points

At each decision point below, STOP and assess before continuing:

| Decision Point | Condition | Action |
|----------------|-----------|--------|
| Snapshot is older than 48 hours | BACKUP_SNAPSHOT_AGE > 48h | Escalate — assess data loss impact before proceeding |
| Restore takes >60 minutes | Duration exceeds expected window | Contact Render Support |
| Restored instance fails to reach "Available" | Status stuck or shows "Error" | Contact Render Support — do NOT switch production DATABASE_URL |
| Migration IDs differ from release source | Missing, extra, or unexpected IDs | STOP — investigate before switching traffic |
| RLS policies missing from restored DB | pg_policies count = 0 | STOP — restore may be from a pre-RLS snapshot |
| Row counts are implausibly low | Any table has 0 rows unexpectedly | STOP — snapshot may be corrupt or from wrong point in time |

---

### B.3 Post-restore validation

Execute all validation queries against `RESTORED_DATABASE_URL` — **not** the production URL.

#### B.3.1 Schema validation

```bash
# MANUAL OPERATOR ACTION REQUIRED

# 1. Confirm applied IDs match the exact reviewed release source
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT id, applied_at FROM schema_migrations ORDER BY applied_at;"
# Expected: exact ordered IDs recorded in the pre-drill plan

# 2. Record the migration count; do not use a hard-coded repository-wide count
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT COUNT(*) AS migration_count FROM schema_migrations;"
# Expected: count derived from the exact release source

# 3. Confirm the final applied migration matches the release source
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT id FROM schema_migrations ORDER BY applied_at DESC LIMIT 1;"
# Expected: final ID recorded in the pre-drill plan
```

#### B.3.2 Data integrity validation

Run business-table checks as the application database role, not a superuser or
table owner that bypasses RLS. For every scoped check:

1. Start a transaction.
2. Set the source-verified transaction-local variables using the same pattern as
   `Backend/src/db/tenantContext.ts`:
   `app.current_clinic_id`, `app.owner_admin_mode`, and
   `app.current_user_id`.
3. Run the query inside that transaction.
4. Roll back so the context cannot leak to a pooled or reused connection.

Use owner-admin context only for the approved cross-clinic inventory of restored
data. Then repeat representative checks with `owner_admin_mode=false` for each
expected clinic. Compare clinics, users, assignments, inventory, adjustments,
roster, timesheets, invoices, audit events, suppliers, catalogue, and master
catalogue data with dated pre-restore evidence.

An unscoped query returning zero rows can be a forced-RLS result and is not
proof of data loss. Stop on an unexpected result, but first confirm the
application role and transaction-local context before diagnosing missing data.

#### B.3.3 RLS and security validation

```bash
# MANUAL OPERATOR ACTION REQUIRED

# 7. Confirm RLS policies are present
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT tablename, policyname, cmd FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, policyname;"
# Expected: at minimum 20+ policies across 14 tenant-scoped tables

# 8. Confirm app_current_clinic_id() function exists
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT proname FROM pg_proc WHERE proname IN ('app_current_clinic_id', 'app_is_owner_admin');"
# Expected: 2 rows

# 9. Confirm RLS is FORCED on key tables
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT tablename, rowsecurity, forcerowsecurity
   FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename IN ('users','invoices','audit_events','clinic_inventory_items')
   ORDER BY tablename;"
# Expected: rowsecurity=true, forcerowsecurity=true for all four
```

Policy/function counts and catalog flags prove only that RLS objects exist; they
do not prove effective isolation. Using the drill application:

1. Authenticate as a user without owner-admin or cross-clinic privileges.
2. Confirm that user can access expected data in its authorised clinic.
3. Attempt equivalent reads and writes against a different clinic with known
   data.
4. Require denial or an empty tenant-scoped result, as appropriate, and confirm
   no cross-clinic write occurred.
5. Repeat representative checks for users, inventory, roster, invoices and
   other critical tenant-scoped workflows.

#### B.3.4 Supplier data validation

Validate supplier and catalogue data through the application role and the same
source-verified transaction-local RLS procedure in B.3.2. Compare representative
supplier, catalogue, relationship and clinic-specific pricing records with
pre-restore evidence. Where a table is global rather than tenant-scoped, record
that source-verified expectation explicitly instead of assuming an unscoped
query tests tenant isolation.

#### B.3.5 Application startup validation

If connecting the restored database to a **test/drill backend service** (not production):

```bash
# MANUAL OPERATOR ACTION REQUIRED

# In the drill backend service environment, set:
#   DATABASE_URL = $RESTORED_DATABASE_URL
#   REDIS_URL = <isolated drill cache; never Production refresh-token storage>
#   JWT_ACCESS_SECRET = <separate drill-only secret>
#   JWT_REFRESH_SECRET = <separate drill-only secret>
#   MFA_ENCRYPTION_KEY = <original Production key only if restored MFA must be decrypted>
#   CORS_ORIGIN = <DRILL_FRONTEND_ORIGIN>
#   NODE_ENV = production
#   MIGRATE_ON_STARTUP = false

# Trigger a manual deploy of the drill backend service.
# Watch deploy logs for:
#   ✓ "Env validation passed"
#   ✓ "Migration check: 0 pending"
#   ✓ "No pending migrations — schema is up to date"
#   ✓ "Server listening on 0.0.0.0:<PORT>"

# Confirm DRILL_API_BASE_URL identifies the isolated drill service, then verify:
curl -s <DRILL_API_BASE_URL>/api/v1/health | jq .status
# Expected: "ok"

curl -s <DRILL_API_BASE_URL>/api/v1/ready | jq '.status, .checks'
# Readiness is necessary but does not prove authentication or refresh works.
```

Before authentication tests, reconfirm the browser origin equals
`DRILL_FRONTEND_ORIGIN`, CORS does not allow a Production frontend, and the
drill API points only to the restored database and isolated cache. Remove the
original `MFA_ENCRYPTION_KEY` from the drill environment immediately after MFA
validation.

---

### B.4 Rollback procedure

#### B.4.1 Abort criteria

Stop the drill and initiate rollback if any of the following occur:

| Abort Criterion | Action |
|----------------|--------|
| Production `DATABASE_URL` was inadvertently changed | Stop writes and begin the authoritative-database decision below; do not immediately switch |
| Restore instance fails to reach "Available" after 60 minutes | Contact Render Support; do not change any production settings |
| Migration IDs differ from the exact release source | Do not route any traffic to the restored instance |
| RLS policies absent from restored instance | Do not route any traffic; restore is from pre-security-hardening snapshot |
| Any production service outage detected during drill | Suspend drill; investigate production health first |

#### B.4.2 Rollback path

```
MANUAL OPERATOR ACTION REQUIRED

If any service may have sent writes to the restored database:

1. Stop application writes before changing database configuration.
2. Confirm the intended environment, API service and both database identities
   without printing connection strings.
3. Determine whether the original database, restored database, or both accepted
   writes after the switch. Use timestamps, audit evidence and application-role,
   RLS-aware checks.
4. Record an explicit incident-owner decision naming the authoritative database
   and addressing reconciliation, duplicate/conflicting writes, and accepted
   data loss.
5. Only then point `<TARGET_API_SERVICE>` at the approved authoritative
   database and redeploy the last schema-compatible full SHA.
6. Confirm `<TARGET_API_BASE_URL>` identifies the intended environment before
   running liveness, readiness, authentication and workflow acceptance.

Preserve both databases until the authoritative-data decision, reconciliation,
incident review and retention approval are complete. Database deletion is not a
routine validation or drill-cleanup step.
```

#### B.4.3 Communication process

| Stage | Communicate to |
|-------|---------------|
| Drill start | Internal team — slack/email noting drill is running, production unaffected |
| Drill abort | Internal team — note reason for abort and production status |
| Drill complete (PASS) | Internal team + management — share sign-off form (Part G) |
| Drill complete (FAIL) | Internal team + management — share risks and corrective actions |
| Production outage during drill | All clinic staff contacts — immediate notification |

---

## Part C — Recovery Verification Checklist

> **Use this checklist after every restore drill and any production restore event.**  
> This checklist assumes the backend service has been pointed at the restored database and redeployed.

---

### C.1 Application

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Backend starts | Deploy logs | `"Server listening on 0.0.0.0:<PORT>"` present |
| 2 | Frontend loads | Browser | Login page renders without JS console errors |
| 3 | Health endpoint healthy | `GET /api/v1/health` | `{ "status": "ok" }` |
| 4 | Readiness endpoint healthy | `GET /api/v1/ready` | `{ "status": "ok" }` with all checks green |
| 5 | No startup migration failures | Deploy logs | No `"Migration Gate"` error; zero pending migrations |
| 6 | CORS headers correct | Browser DevTools → Network | No CORS errors on API calls |

---

### C.2 Database

For items 8–16, use the application role and transaction-local RLS procedure in
B.3.2. Never score an unscoped zero count as proof of missing data.

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 7 | Migrations current | `psql` query on `schema_migrations` | IDs exactly match the reviewed release source |
| 8 | Clinics present | `psql` query | At least 1 active clinic row |
| 9 | Users present | `psql` query | At least 1 active user with role `owner_admin` |
| 10 | Inventory items present | `psql` query on `clinic_inventory_items` | Row count matches pre-restore expectation |
| 11 | Master catalog present | `psql` query on `master_catalog_items` | Row count > 0 |
| 12 | Suppliers present | `psql` query on `suppliers` | Row count matches pre-restore expectation |
| 13 | Supplier catalogue present | `psql` query on `supplier_catalogue` | Row count matches pre-restore expectation |
| 14 | Audit events present | `psql` query on `audit_events` | Row count > 0 |
| 15 | Roster entries present | `psql` query on `roster_entries` | Row count matches pre-restore expectation |
| 16 | Invoice records present | `psql` query on `invoices` | Row count matches pre-restore expectation |

---

### C.3 Security

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 17 | Authentication works | `POST /api/v1/auth/login` with known credentials | `200` response with `accessToken` |
| 18 | MFA enrollment remains functional | Login with MFA-enrolled account | TOTP challenge presented; valid code accepted |
| 19 | RLS protection intact | `psql` query on `pg_policies` | ≥20 policies present; `rowsecurity=true`, `forcerowsecurity=true` on tenant tables |
| 20 | RLS helper functions present | `psql` query on `pg_proc` | Both `app_current_clinic_id` and `app_is_owner_admin` exist |
| 21 | JWT validation functioning | Use the access token on an authenticated endpoint | Request succeeds for the expected user |
| 22 | Token refresh functioning | `POST /api/v1/auth/refresh` with refresh cookie | New `accessToken` returned |
| 22a | Browser reload persistence | Reload an authenticated browser session | Session is restored through valid access state or refresh |
| 23 | Cross-clinic isolation | Attempt representative reads and writes in Clinic B using a Clinic A user without cross-clinic privileges | Read is denied or tenant-empty; write is denied and no row is created or changed |
| 23a | Logout and reload | Log out, then reload the browser | Cookie cleared and session remains unauthenticated |

---

### C.4 Operations

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 24 | Forecast endpoints working | `GET /api/v1/forecast/materials` (with auth) | `200` response or expected empty result |
| 25 | Procurement endpoints working | `GET /api/v1/procurement/purchase-orders` (with auth) | `200` response |
| 26 | Inventory endpoints working | `GET /api/v1/inventory` (with auth) | `200` response with clinic inventory |
| 27 | Roster endpoints working | `GET /api/v1/roster` (with auth) | `200` response |
| 28 | Supplier endpoints working | `GET /api/v1/suppliers` (with auth) | `200` response |
| 29 | Billing endpoints working | `GET /api/v1/billing/invoices` (with auth) | `200` response |
| 30 | Analytics/audit endpoints working | `GET /api/v1/analytics` (with auth) | `200` response |

---

### C.5 Checklist scoring

| Range | Interpretation |
|-------|---------------|
| 30/30 | PASS — restore successful, service fully operational |
| 25–29/30 | PASS WITH RISKS — document failed items and corrective actions |
| <25/30 | FAIL — do not route production traffic; investigate before proceeding |

---

## Part D — Secrets Recovery

### D.1 MFA_ENCRYPTION_KEY

| Property | Detail |
|----------|--------|
| **Purpose** | AES-256 symmetric encryption key used to encrypt TOTP secrets before storing them in the `users.totp_secret` column. Every user who completes MFA enrollment has their TOTP seed encrypted with this key. |
| **Format** | 64-character hexadecimal string (32 bytes) |
| **Impact if lost** | **CATASTROPHIC** — all MFA-enrolled users are permanently locked out. The encrypted `totp_secret` values in PostgreSQL cannot be decrypted. There is no recovery path without the original key. Users must disable MFA, re-enrol, and acknowledge their MFA is reset. |
| **Recovery method** | **Cannot be regenerated** — generating a new key does not restore access. If the key is lost: (1) generate a new key, (2) set `mfa_enabled = false` and `totp_secret = NULL` for all users, (3) notify all users to re-enrol MFA. |
| **Backup recommendation** | Store in a dedicated secrets manager (AWS Secrets Manager, 1Password Secrets Automation, Bitwarden Secrets Manager). Minimum two authorised personnel must have access. Never commit to git. Store independently of the Render dashboard. |
| **Pilot requirement** | **MANDATORY** — must be stored in a second location before pilot launch. At least two team members must be able to retrieve it independently. |

---

### D.2 JWT_ACCESS_SECRET

| Property | Detail |
|----------|--------|
| **Purpose** | HMAC signing secret for short-lived access tokens (JWT, 15-minute TTL). Used to sign and verify every authenticated API request. |
| **Format** | Minimum 32-character random string (48 bytes recommended) |
| **Impact if lost** | **HIGH** — can be regenerated without data loss. Regenerating invalidates all current access tokens; users are forced to log in again within 15 minutes. No persistent data is affected. |
| **Recovery method** | Generate new secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` — set in Render environment, trigger redeploy. All active access tokens immediately become invalid. |
| **Backup recommendation** | Store in the same secrets manager as `MFA_ENCRYPTION_KEY`. Rotation is safe and recommended every 90 days. |
| **Pilot requirement** | **MANDATORY** — must be stored in a second location. Recovery is safe but causes session disruption. |

---

### D.3 JWT_REFRESH_SECRET

| Property | Detail |
|----------|--------|
| **Purpose** | HMAC signing secret for long-lived refresh tokens (JWT, 7-day TTL). Stored reference is kept in Redis; the signed token is issued to the client as an `httpOnly` cookie. |
| **Format** | Minimum 32-character random string (48 bytes recommended) |
| **Impact if lost** | **HIGH** — can be regenerated without data loss. Regenerating invalidates all current refresh tokens; all users must log in again within 15 minutes (when their access tokens expire). No persistent data is affected. |
| **Recovery method** | Same as `JWT_ACCESS_SECRET` — generate new, set in Render, redeploy. Flush Redis token store after rotation for clean state: `redis-cli FLUSHDB` (acceptable — Redis is ephemeral). |
| **Backup recommendation** | Store alongside `JWT_ACCESS_SECRET`. Rotate together on the same schedule. |
| **Pilot requirement** | **MANDATORY** — must be stored in a second location. |

---

### D.4 DATABASE_URL

| Property | Detail |
|----------|--------|
| **Purpose** | PostgreSQL connection string granting the application full read/write access to the database. Contains hostname, port, username, password, and database name. |
| **Format** | `postgresql://user:password@host:5432/dbname?sslmode=verify-full` |
| **Impact if lost** | **MEDIUM** — recoverable. The connection string can be retrieved from the Render dashboard ("Connect" tab on the PostgreSQL instance). However, if the Render account is inaccessible, the string cannot be retrieved and the application cannot start. |
| **Recovery method** | Log in to Render dashboard → PostgreSQL instance → "Connect" → copy External Database URL. If the Render account is inaccessible, contact Render Support with proof of ownership. |
| **Backup recommendation** | Copy the DATABASE_URL to the same secrets manager as the JWT/MFA keys. Note that this value **rotates** every time a new database instance is created (e.g., after a restore). Always update the secrets manager entry after any restore operation. |
| **Pilot requirement** | **RECOMMENDED** — store a copy outside Render. Ensure the team knows the URL rotates on restore. |

---

### D.5 REDIS_URL

| Property | Detail |
|----------|--------|
| **Purpose** | Redis connection string for the refresh token store. The application uses Redis to validate and revoke refresh tokens. |
| **Format** | `rediss://:password@host:port` (TLS required for production) |
| **Impact if lost** | **LOW** — recoverable without data loss. Redis is ephemeral (refresh tokens only). Regenerating the connection string or restarting the Redis instance causes all users to re-authenticate, but no business data is lost. |
| **Recovery method** | Retrieve from Render (or Upstash/Redis provider) dashboard → Redis instance → Connect details. Update `REDIS_URL` in the Render backend environment variables and redeploy. |
| **Backup recommendation** | Copy to secrets manager. Note that some Redis providers rotate credentials on instance restart — always verify the URL is current before deploying. |
| **Pilot requirement** | **RECOMMENDED** — store a copy outside Render. |

---

### D.6 Secrets recovery decision matrix

| Secret | Lost and irrecoverable | Recovery time | User impact |
|--------|------------------------|---------------|-------------|
| `MFA_ENCRYPTION_KEY` | All MFA users permanently locked out | Hours to days (manual re-enrollment) | **CRITICAL** |
| `JWT_ACCESS_SECRET` | None | <5 minutes (regenerate + redeploy) | Re-login required in 15 min |
| `JWT_REFRESH_SECRET` | None | <5 minutes (regenerate + redeploy) | Immediate re-login required |
| `DATABASE_URL` | Cannot start application | 15 min (dashboard retrieval) or hours (Render Support) | Full service outage |
| `REDIS_URL` | Session loss only | 10 min (dashboard retrieval + redeploy) | Re-login required |

---

## Part E — Pilot Recovery Targets

### E.1 Definitions

| Term | Definition |
|------|-----------|
| **RPO** (Recovery Point Objective) | Maximum acceptable data loss measured in time — how far back in time the recovered data may be |
| **RTO** (Recovery Time Objective) | Maximum acceptable total downtime from incident declaration to service restoration |

---

### E.2 Current state (reviewed 2026-10-13)

| Component | Current RPO | Current RTO | Notes |
|-----------|------------|------------|-------|
| PostgreSQL | **Unverified** | **Unverified** | Confirm provider configuration and measure a restore |
| Redis | Session data is ephemeral | **Unverified** | Loss requires authentication acceptance and likely re-login |
| Backend application | N/A | **Unverified** | Production auto-deploy must remain off |
| Frontend application | N/A | **Unverified** | Production auto-deploy must remain off |
| Environment variables/secrets | N/A | **Unverified** | Confirm approved recovery access |
| Full end-to-end recovery | **Unverified** | **Unverified** | Requires a completed drill |

---

### E.3 Pilot recovery targets

> Targets for the internal pilot phase (≤20 users, non-patient-facing, non-commercial).

| Metric | Target | Rationale |
|--------|--------|-----------|
| **RPO** | **24 hours** | Acceptable for internal team pilot — no patient data, no billing |
| **RTO** | **2 hours** | Internal team can tolerate a 2-hour outage during pilot |
| Restore drill frequency | **Once before pilot launch** | At least one verified drill is required |
| Secrets backup | **Before pilot launch** | MFA_ENCRYPTION_KEY + JWT secrets must be in a second location |
| Render plan | **Minimum Starter** | Avoid free-tier auto-suspension |

**Pilot RPO status: UNVERIFIED.**
**Pilot RTO status: UNVERIFIED.**

---

### E.4 Commercial launch recovery targets

> Targets required before onboarding paying clinic customers with real patient-facing operations.

| Metric | Target | Requirement to achieve |
|--------|--------|----------------------|
| **RPO** | **1 hour** | Render Standard plan with PITR enabled |
| **RTO** | **30 minutes** | Partial automation of restore + runbook drills |
| Restore drill frequency | **Monthly** | Documented and signed off |
| Cross-region backup | **Daily offsite copy** | Scheduled `pg_dump` to S3 or equivalent |
| Secrets management | **AWS Secrets Manager or equivalent** | Automated rotation + audit trail |
| Infrastructure-as-Code | **`render.yaml` committed** | Eliminates manual service reconfiguration |
| Backup verification | **Weekly automated restore check** | Prevents silent backup corruption |

**Commercial RPO status: NOT MET** — requires Render Standard + PITR.  
**Commercial RTO status: NOT MET** — requires automation and regular drills.

---

### E.5 Recovery targets summary

| Tier | RPO | RTO | Status |
|------|-----|-----|--------|
| **Current state** | Unverified | Unverified | No completed drill |
| **Internal pilot target** | 24 hours | 2 hours | Target only; achievement unverified |
| **Commercial launch target** | 1 hour | 30 minutes | NOT YET MET |
| **Future production SLA** | 15 minutes | 15 minutes | Requires HA architecture |

---

## Part F — Render Readiness Review

### F.1 Current Render deployment model

| Component | Render service type | Notes |
|-----------|-------------------|-------|
| Backend API | Web Service (Node.js) | `verve-dental-api` |
| Frontend | Static Site | `verve-dental-frontend` |
| PostgreSQL | Managed PostgreSQL | Single instance, no replica |
| Redis | Managed Redis (or Upstash) | Single instance, ephemeral |

**Architecture summary:** Single-region, single-instance deployment. No read replicas, no hot standby, no Infrastructure-as-Code. All configuration lives exclusively in the Render dashboard.

---

### F.2 Free-tier limitations

| Limitation | Operational Risk | Impact |
|-----------|-----------------|--------|
| Web services sleep after 15 minutes of inactivity | First request after sleep takes 30–60 seconds | Clinic staff experience slow first-load — unacceptable in production |
| Free PostgreSQL auto-suspends after 90 days of inactivity | Database unavailable; backups may be lost | Critical for pilot if database is idle during low-activity periods |
| Free PostgreSQL deleted after 6 months | All data permanently lost | Catastrophic if not on paid plan |
| No PITR on free tier | 24-hour RPO maximum | Acceptable for pilot only |
| 512 MB RAM on free web service | Memory pressure under concurrent load | May cause OOM crashes during peak usage |
| No custom domains on free tier | `onrender.com` subdomain only | Acceptable for pilot; required for commercial |

---

### F.3 Operational risks

| Risk | Severity | Likelihood | Detail |
|------|----------|-----------|--------|
| Single point of failure: no standby | HIGH | High | Any Render instance failure causes full outage |
| Dashboard-only restore (no API) | HIGH | Low | If Render dashboard is unavailable, restore cannot proceed |
| No render.yaml / IaC | HIGH | Medium | Service configuration cannot be reproduced without manual dashboard recreation |
| Account lockout blocks all recovery | HIGH | Low | Single account owner is a recovery SPOF |
| Secrets exist only in Render dashboard | HIGH | Low | Render dashboard outage = secrets inaccessible |
| Cold start latency on free web service | MEDIUM | High | 30–60 second delays after inactivity are visible to users |
| Cross-region failure destroys backups | MEDIUM | Very Low | Render stores backup snapshots in the same AWS region as the database |

---

### F.4 Manual recovery dependencies

The following recovery steps have **no automation** and require human intervention:

| Step | Manual Action Required | Estimated Time |
|------|----------------------|----------------|
| Database restore | Render dashboard → Backups → Restore | 15–45 min |
| DATABASE_URL update | Render dashboard → Environment variables | 2–5 min |
| Backend redeploy | Render dashboard → Manual Deploy | 3–8 min |
| Secrets recovery | Secrets manager / password manager lookup | 5–15 min |
| Verification queries | psql direct connection to restored DB | 10–20 min |
| Smoke test | Manual browser + curl commands | 10–20 min |

**Total minimum manual effort per restore: ~45–113 minutes**

---

### F.5 Upgrade recommendations

#### Required before pilot

| Item | Action | Priority | Effort |
|------|--------|----------|--------|
| Confirm database is NOT on free tier | Check Render dashboard — upgrade to Starter if needed | **P0** | Minimal (plan upgrade only) |
| Perform restore drill before pilot | Execute Part B of this runbook | **P0** | 2–4 hours |
| Store secrets in a second location | Copy MFA_ENCRYPTION_KEY and JWT secrets to password manager with 2+ authorised holders | **P0** | 1–2 hours |
| Confirm Render account has 2+ admin users | Add a second team member as Render Owner | **P0** | 15 minutes |

#### Recommended before pilot

| Item | Action | Priority | Effort |
|------|--------|----------|--------|
| Upgrade web service from free to Starter | Eliminates cold-start sleep | **P1** | Minimal |
| Document actual Render service IDs | Record exact service names/IDs in this runbook | **P1** | 30 minutes |
| Brief pilot team on RPO/RTO expectations | Written acknowledgment that 24h RPO is acceptable | **P1** | 1 hour |

#### Commercial launch requirements

| Item | Action | Priority | Effort |
|------|--------|----------|--------|
| Upgrade to Render Standard plan (PITR) | Reduces RPO from 24h to ~5 minutes | **P0** | Low (plan upgrade) |
| Add `render.yaml` Infrastructure-as-Code | Enables service recreation without dashboard | **P1** | 1 day |
| Scheduled `pg_dump` to S3 / offsite storage | Cross-provider backup independence | **P1** | 1–2 days |
| AWS Secrets Manager integration | Automated rotation + audit trail | **P1** | 1 day |
| Monthly restore drill process | Documented, signed off, recurring calendar event | **P1** | Ongoing |
| Read replica or Render HA PostgreSQL | Reduces RTO — replica available during restore | **P2** | 1–2 days |
| Automated backup verification | Weekly test-restore pipeline | **P2** | 3–5 days |

---

## Part G — Restore Drill Sign-Off Template

> Copy and complete this form for every restore drill. Store the completed form in a secure location alongside the drill results.

---

```
═══════════════════════════════════════════════════════════════
VERVE OPERATIONAL SUITE — RESTORE DRILL SIGN-OFF
Sprint K.1 — Recovery Verification
═══════════════════════════════════════════════════════════════

DATE:               ____________________________
PERFORMED BY:       ____________________________  (name & role)
BACKUP SOURCE:      ____________________________  (Render snapshot label / timestamp)
RESTORE TARGET:     ____________________________  (new instance name, e.g. verve-db-drill-YYYYMMDD)

START TIME:         ________  UTC
FINISH TIME:        ________  UTC
DURATION:           ________  minutes

────────────────────────────────────────────────────────────────
PRE-DRILL CHECKS (B.1)
────────────────────────────────────────────────────────────────

  □ Backup source identified and snapshot confirmed
  □ Restore target is a NEW instance (not production)
  □ Production DATABASE_URL recorded for rollback
  □ Production backend confirmed healthy before drill
  □ Secrets accessible: MFA_ENCRYPTION_KEY, JWT secrets
  □ Expected migration IDs derived from the exact release SHA

────────────────────────────────────────────────────────────────
RESTORE PROCESS (B.2)
────────────────────────────────────────────────────────────────

  □ Snapshot restore triggered in Render dashboard
  □ Restore completed within expected window
  □ Restored database URL extracted

────────────────────────────────────────────────────────────────
SCHEMA VALIDATION (B.3.1)
────────────────────────────────────────────────────────────────

  □ Applied migration IDs exactly match the release source
  □ Last migration confirmed: ______________________________
  □ Pass / FAIL: ________________

────────────────────────────────────────────────────────────────
DATA INTEGRITY (B.3.2)
────────────────────────────────────────────────────────────────

  Record row counts:

    clinics:              ______
    users:                ______
    clinic_inventory:     ______
    roster_entries:       ______
    invoices:             ______
    audit_events:         ______
    suppliers:            ______
    supplier_catalogue:   ______

  □ All counts match pre-restore expectations
  □ Pass / FAIL: ________________

────────────────────────────────────────────────────────────────
SECURITY VALIDATION (B.3.3)
────────────────────────────────────────────────────────────────

  □ RLS policies present: ______ policies found
  □ Helper functions present: app_current_clinic_id, app_is_owner_admin
  □ FORCE ROW LEVEL SECURITY confirmed on tenant tables
  □ Pass / FAIL: ________________

────────────────────────────────────────────────────────────────
APPLICATION STARTUP (B.3.5)
────────────────────────────────────────────────────────────────

  □ Drill backend service started successfully
  □ Health endpoint: GET /health → ________
  □ Readiness endpoint: GET /ready → ________
  □ Authentication smoke test: login → ________ (pass/fail)
  □ MFA challenge tested (if MFA user available): ________ (pass/fail)
  □ Pass / FAIL: ________________

────────────────────────────────────────────────────────────────
VERIFICATION CHECKLIST SCORE (Part C)
────────────────────────────────────────────────────────────────

  Checks passed:    ______ / 30
  Checks failed:    ______

  Failed checks (list item numbers):
  _______________________________________________

────────────────────────────────────────────────────────────────
ISSUES FOUND
────────────────────────────────────────────────────────────────

  (describe any unexpected findings, errors, or deviations from expected results)

  _______________________________________________
  _______________________________________________
  _______________________________________________

────────────────────────────────────────────────────────────────
CORRECTIVE ACTIONS
────────────────────────────────────────────────────────────────

  (list actions required before next drill or before pilot launch)

  1. ____________________________________________
  2. ____________________________________________
  3. ____________________________________________

────────────────────────────────────────────────────────────────
RESULT
────────────────────────────────────────────────────────────────

  Circle one:     PASS     /     PASS WITH RISKS     /     FAIL

  If PASS WITH RISKS — describe conditions:
  _______________________________________________

  If FAIL — describe blocking issues:
  _______________________________________________

────────────────────────────────────────────────────────────────
PILOT GO / NO-GO RECOMMENDATION
────────────────────────────────────────────────────────────────

  Based on this drill result, the recommendation for internal pilot launch is:

    □ GO               — restore drill passed; pilot can proceed
    □ GO WITH CONDITIONS — drill passed with known risks; conditions listed above
    □ NO GO            — drill failed; conditions must be resolved before pilot

────────────────────────────────────────────────────────────────
APPROVAL
────────────────────────────────────────────────────────────────

  APPROVED BY:        ____________________________  (name & role)
  APPROVAL DATE:      ____________________________
  SIGNATURE:          ____________________________

═══════════════════════════════════════════════════════════════
```

---

## Part H — Pilot Go / No-Go Criteria

### H.1 Internal pilot recovery readiness assessment

#### H.1.1 Backup availability

| Criterion | Status | Evidence |
|-----------|--------|---------|
| At least one database snapshot exists within 24 hours | ⬜ VERIFY | Check Render dashboard Backups tab |
| Database is not on free tier (auto-suspension risk) | ⬜ VERIFY | Check Render plan in dashboard |
| Backup retention is at least 7 days | ⬜ VERIFY | Confirm via Render plan details |

**Backup Availability: NOT VERIFIED**
Snapshot existence, plan behavior, retention, and restorability must all be
confirmed before pilot.

---

#### H.1.2 Restore process

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Restore drill completed at least once | ⬜ NOT YET PERFORMED | No drill record exists |
| Restore drill result was PASS or PASS WITH RISKS | ⬜ PENDING DRILL | — |
| Restore duration is within 2-hour RTO target | ⬜ PENDING DRILL | Expected 45–120 min based on architecture |
| Verified checklist score ≥25/30 | ⬜ PENDING DRILL | — |

**Restore Process: NOT READY**  
No restore drill has been performed. This is the highest-priority action before pilot launch.

---

#### H.1.3 Secrets recovery

| Criterion | Status | Evidence |
|-----------|--------|---------|
| `MFA_ENCRYPTION_KEY` stored in a second location | ⬜ VERIFY | Must confirm with account holder |
| `JWT_ACCESS_SECRET` stored in a second location | ⬜ VERIFY | Must confirm with account holder |
| `JWT_REFRESH_SECRET` stored in a second location | ⬜ VERIFY | Must confirm with account holder |
| At least 2 team members can access secrets independently | ⬜ VERIFY | Must confirm with team |
| Secrets recovery procedure documented | ✅ READY | Part D of this document |

**Secrets Recovery: PARTIALLY READY**  
Recovery procedures are documented. Physical storage in a second location must be confirmed and verified before pilot.

---

#### H.1.4 Infrastructure recovery

| Criterion | Status | Evidence |
|-----------|--------|---------|
| At least 2 team members have Render Owner/Admin access | ⬜ VERIFY | Check Render team settings |
| Render account has a verified recovery email | ⬜ VERIFY | Check Render account settings |
| Render service names/IDs are documented | ⬜ VERIFY | Not documented in any current runbook |
| Rollback path to pre-restore state is documented | ✅ READY | Part B.4 of this document |

**Infrastructure Recovery: PARTIALLY READY**  
Rollback procedures are documented. Render access controls and service IDs must be confirmed.

---

#### H.1.5 Application recovery

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Application starts cleanly from restored database | ⬜ PENDING DRILL | Procedure documented in B.3.5 |
| Health and readiness endpoints verified post-restore | ⬜ PENDING DRILL | — |
| Authentication works post-restore | ⬜ PENDING DRILL | — |
| MFA enrollment survives restore | ⬜ PENDING DRILL | Requires same `MFA_ENCRYPTION_KEY` |
| All route categories verified post-restore | ⬜ PENDING DRILL | Checklist in Part C |

**Application Recovery: NOT READY**  
All application recovery verification is pending the restore drill.

---

#### H.1.6 Operational documentation

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Backup & restore runbook exists | ✅ READY | `docs/runbooks/backup-restore.md` |
| Database down runbook exists | ✅ READY | `docs/runbooks/database-down.md` |
| Redis down runbook exists | ✅ READY | `docs/runbooks/redis-down.md` |
| Deployment failure runbook exists | ✅ READY | `docs/runbooks/deployment-failure.md` |
| Restore drill runbook exists | ✅ READY | This document |
| Recovery verification checklist exists | ✅ READY | Part C of this document |
| Secrets recovery procedure documented | ✅ READY | Part D of this document |
| Sign-off template exists | ✅ READY | Part G of this document |
| Pilot team briefed on RPO/RTO | ⬜ PENDING | Brief required before pilot launch |

**Operational Documentation: PARTIALLY READY**
The files exist, but provider procedures and recovery claims remain unverified
until a successful drill and release review.

---

### H.2 Category summary

| Category | Rating | Notes |
|----------|--------|-------|
| Backup Availability | **PARTIALLY READY** | Verify non-free-tier plan; snapshots unverified |
| Restore Process | **NOT READY** | No drill performed — highest priority action |
| Secrets Recovery | **PARTIALLY READY** | Procedures documented; physical storage unconfirmed |
| Infrastructure Recovery | **PARTIALLY READY** | Rollback documented; Render access controls unconfirmed |
| Application Recovery | **NOT READY** | All verification pending drill completion |
| Operational Documentation | **PARTIALLY READY** | Files exist; provider procedure remains unverified |

---

### H.3 Overall pilot recommendation

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   OVERALL PILOT RECOMMENDATION:  NO GO — GATES OPEN        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Verve is not yet GO for internal pilot from a recovery readiness perspective.**

The procedures still contain provider assumptions that require live
verification. The following conditions **must be satisfied** before the pilot
go/no-go decision is confirmed:

| # | Condition | Owner | Deadline |
|---|-----------|-------|----------|
| 1 | Perform and pass a restore drill (Part B) | Lead Engineer | Before pilot launch |
| 2 | Confirm database is not on Render free tier | Account Owner | Immediate |
| 3 | Store `MFA_ENCRYPTION_KEY` in a second location accessible to ≥2 people | Account Owner | Before pilot launch |
| 4 | Store JWT secrets in a second location | Lead Engineer | Before pilot launch |
| 5 | Add a second Render Owner/Admin to the account | Account Owner | Before pilot launch |
| 6 | Brief pilot team on the approved RPO target and verified capability | Lead Engineer | Before pilot launch |

No automatic upgrade to **GO** is implied. After the gates are satisfied, an
authorised release review must assess the evidence and record a new decision.

---

## Part I — Remaining Risks

### I.1 Critical risks

| ID | Risk | Impact | Mitigation | Owner |
|----|------|--------|-----------|-------|
| CR-01 | **No restore drill ever performed** — Render snapshots have never been tested for restorability. A corrupt or unrestorable snapshot would only be discovered during a real incident. | Full data loss with no recovery path | Perform drill before pilot launch (Part B) | Lead Engineer |
| CR-02 | **`MFA_ENCRYPTION_KEY` has no confirmed second storage location** — If lost, all MFA-enrolled users are permanently locked out with no recovery path except a full MFA reset for all users. | All MFA users permanently locked out | Store key in password manager with ≥2 authorised holders before pilot | Account Owner |
| CR-03 | **Database may be on free tier** — Render free PostgreSQL auto-suspends after 90 days and is deleted after 6 months, destroying all data and backups. | All data permanently lost | Confirm plan in Render dashboard; upgrade to Starter immediately if on free tier | Account Owner |

---

### I.2 High risks

| ID | Risk | Impact | Mitigation | Owner |
|----|------|--------|-----------|-------|
| HR-01 | **Single Render account owner** — If the account owner is unavailable (illness, departure), no recovery operations can proceed. | Full recovery blocked | Add second Render Owner; store account credentials in shared password manager | Account Owner |
| HR-02 | **Migration expectations can become stale** — fixed counts and final IDs become invalid when migrations are added. | Incomplete schema accepted | Derive exact IDs from the immutable release SHA for each drill | Lead Engineer |
| HR-03 | **No cross-region or offsite backup** — Render stores snapshots in the same AWS region as the primary database. A regional AWS outage destroys both the primary database and all its snapshots simultaneously. | Total irrecoverable data loss | Add scheduled `pg_dump` export to independent object storage (S3 / Cloudflare R2) as a commercial requirement | Lead Engineer |
| HR-04 | **No automated failover or standby** — Any failure of the primary PostgreSQL instance requires full manual restore (45–120 minutes). There is no read replica or hot standby to absorb traffic. | Full service outage during restore | Accept for pilot; upgrade to Render HA or add read replica before commercial launch | Lead Engineer |

---

### I.3 Medium risks

| ID | Risk | Impact | Mitigation | Owner |
|----|------|--------|-----------|-------|
| MR-01 | **24-hour RPO may not meet pilot user expectations** — Even for an internal team, losing a full day of inventory adjustments, roster entries, or billing records may be disruptive. | Day of operational data lost | Brief pilot team explicitly on RPO before launch; accept in writing | Lead Engineer |
| MR-02 | **DATABASE_URL must be manually updated after every restore** — A forgotten update leaves the application connected to the old (possibly deleted) database. | Application connects to wrong or deleted database | Add a checklist step explicitly confirming DATABASE_URL update; automate with render.yaml in future | Lead Engineer |
| MR-03 | **No render.yaml / Infrastructure-as-Code** — If the Render account or services are lost, recreating the full environment requires manual dashboard configuration with no repeatable playbook. | Extended RTO; potential misconfiguration | Create `render.yaml` before commercial launch (P1) | Lead Engineer |
| MR-04 | **Secrets exist only in Render dashboard** — If Render is unavailable (outage, maintenance), secrets cannot be retrieved and a new deployment cannot be configured. | Cannot deploy application during Render outage | Store all secrets independently in a password manager or AWS Secrets Manager | Lead Engineer |
| MR-05 | **Recovery queries can drift from the schema**. | Delayed or false verification | Validate every query against the exact release source before each drill | Lead Engineer |

---

### I.4 Low risks

| ID | Risk | Impact | Mitigation | Owner |
|----|------|--------|-----------|-------|
| LR-01 | **Redis has no persistence** — Intentional design. All refresh tokens are lost on Redis restart. | All users must re-authenticate | Accept; documented in redis-down.md; notify users | Lead Engineer |
| LR-02 | **Migration advisory lock may delay cold starts if two instances scale simultaneously** — `pg_advisory_xact_lock` serializes concurrent migrations but adds latency. | Delayed startup on concurrent scale events | Accept; idempotent migrations make this safe | Lead Engineer |
| LR-03 | **Recovery checklist maintenance is manual.** | Operator confusion after schema changes | Revalidate table and endpoint names for each release | Lead Engineer |
| LR-04 | **Free tier cold start latency** — If the backend web service is on the free plan, the first request after 15 minutes of inactivity takes 30–60 seconds. Clinic staff will perceive this as a slow or broken system. | Poor first impression during pilot | Upgrade web service from free to Starter ($7/month) | Account Owner |

---

## Related runbooks

- [Backup & Restore](./backup-restore.md)
- [Database Unavailable](./database-down.md)
- [Redis Unavailable](./redis-down.md)
- [Deployment Failure](./deployment-failure.md)

---

*This document was produced as part of Sprint K.1 — Restore Drill & Recovery Verification, Post Sprint O.2.*
