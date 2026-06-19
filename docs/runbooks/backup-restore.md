# Runbook: Backup & Restore

**Service:** Verve Operational Suite — Full Stack  
**Severity:** P1 — Critical (data recovery scenario)  
**Last reviewed:** 2026-06-20  
**Release:** Post Sprint O.2

---

## Table of Contents

1. [Backup Assessment](#1-backup-assessment)
2. [Recovery Objectives](#2-recovery-objectives)
3. [PostgreSQL Restore Procedure](#3-postgresql-restore-procedure)
4. [Redis Recovery](#4-redis-recovery)
5. [Application Redeployment](#5-application-redeployment)
6. [Environment Variable Recovery](#6-environment-variable-recovery)
7. [Full Recovery Checklist](#7-full-recovery-checklist)
8. [Gap Analysis](#8-gap-analysis)
9. [Operational Readiness Review](#9-operational-readiness-review)
10. [Escalation](#10-escalation)

---

## 1. Backup Assessment

### 1.1 What data exists

| Data store | Contents | Persistent? |
|------------|----------|-------------|
| **PostgreSQL** | Clinics, users, inventory, roster, payroll, billing, audit events, schema migrations | **Yes — sole source of truth** |
| **Redis** | Refresh token store (session management only) | **No — ephemeral; acceptable to lose** |
| **File system** | None — no uploaded files or local storage | N/A |

All business-critical data lives exclusively in **PostgreSQL**.

---

### 1.2 Current backup mechanism

Verve's PostgreSQL database is hosted on **Render** as a managed PostgreSQL service. Render performs automated daily snapshots of the database volume.

> **No backup scripts exist in this repository.** Backup capability is entirely delegated to the Render managed-database service.

| Property | Free / Starter plan | Standard plan and above |
|----------|---------------------|------------------------|
| Backup type | Daily snapshot (full) | Daily snapshot + Point-in-Time Recovery (PITR) |
| Backup frequency | Once every 24 hours | Once every 24 hours (continuous WAL for PITR) |
| Retention period | **7 days** | **30 days** |
| Manual backup trigger | Not available via dashboard | Not available via self-service |
| Backup location | Render-managed object storage (AWS S3-backed) | Same |
| Encryption at rest | Yes (Render-managed keys) | Yes |
| Cross-region replication | **Not enabled** | Not enabled by default |
| Self-service restore | Dashboard only | Dashboard only |

**Source:** [Render PostgreSQL documentation](https://render.com/docs/postgresql#backups)

> **Important:** Render free-tier PostgreSQL databases are **suspended after 90 days of inactivity** and **deleted after 6 months**. Confirm the current plan tier in the Render dashboard before relying on backup retention figures above.

---

### 1.3 Redis backup

Redis on Render (or Upstash/Railway equivalent) stores **only refresh tokens** — ephemeral session data. Redis data loss requires all users to log in again; no business data is lost. No backup of Redis is required or recommended.

---

### 1.4 Migrations as schema backup

The application schema is **fully reproducible** from source code. The `schema_migrations` table tracks which of the 16 embedded migrations (`003_users_schema` through `018_supplier_catalogue_schema`) have been applied. Running `npm run migrate` against a fresh empty database recreates the full schema deterministically.

> **Sprint O.2 note:** Migrations `017_suppliers_schema` and `018_supplier_catalogue_schema` were added in Sprint O. Any restore verification that checks for 15 migrations will give a false-pass result. Always verify for 16.

This means **schema recovery does not require backup restoration** — only data recovery does.

---

## 2. Recovery Objectives

### 2.1 Definitions

| Term | Definition |
|------|-----------|
| **RPO** (Recovery Point Objective) | Maximum acceptable data loss measured in time — how far back in time the restored data may be |
| **RTO** (Recovery Time Objective) | Maximum acceptable downtime — how long recovery is allowed to take before service is restored |

### 2.2 Current RPO

| Scenario | RPO |
|----------|-----|
| Render free/starter plan (daily backups, 7-day retention) | **Up to 24 hours** of data loss |
| Render standard plan with PITR enabled | **Up to ~5 minutes** of data loss |
| Redis (refresh tokens only) | **Data loss fully acceptable** — users re-authenticate |

**Current realistic RPO: 24 hours** (assuming free/starter plan without PITR).

### 2.3 Current RTO

| Component | Time estimate | Notes |
|-----------|--------------|-------|
| Render PostgreSQL restore (from snapshot) | 15–45 min | Depends on DB size; performed via Render dashboard |
| Render service redeploy | 3–8 min | `npm run build` + startup |
| Environment variable audit & correction | 5–30 min | Depends on secret manager access |
| Migration reapplication (if restored to clean DB) | 1–3 min | `npm run migrate` |
| DNS propagation (if service URL changes) | 0–60 min | Render service URLs are stable unless re-created |
| Frontend redeploy | 3–5 min | Static build; Render auto-deploys from `main` |
| Smoke testing & verification | 15–30 min | Follow Section 7 checklist |

**Current realistic RTO: 45–120 minutes** (single-region; Render-managed restore).

### 2.4 Target objectives (recommended)

| Tier | Target RPO | Target RTO | Enables |
|------|-----------|-----------|---------|
| Internal pilot (current) | 24 hours | 2 hours | Acceptable for internal team testing |
| Early commercial (near-term) | 1 hour | 30 min | Requires Render Standard + PITR |
| Production SLA (future) | 15 min | 15 min | Requires PITR + automated failover + runbook drills |

---

## 3. PostgreSQL Restore Procedure

> **When to use:** Data corruption, accidental deletion, provider-level failure, or any scenario where the live database cannot be trusted.

### 3.1 Prerequisites

- Access to the **Render dashboard** with Owner or Admin role on the Verve project.
- The `DATABASE_URL` environment variable from the **current** service (for verification before cutover).
- A recent list of any pending/unapplied schema changes.

### 3.2 Restore from Render snapshot (dashboard method)

```
Step 1 — Identify the target restore point
──────────────────────────────────────────
1. Log in to https://dashboard.render.com
2. Navigate to: PostgreSQL → <verve-database-instance>
3. Click "Backups" in the left-hand nav
4. Identify the most recent snapshot before the data-loss event
   Note: Snapshots are labelled with their UTC timestamp

Step 2 — Trigger the restore
─────────────────────────────
1. Click "Restore" on the target snapshot
2. Choose: Restore to a NEW database instance
   (Do NOT restore over the live instance until verified)
3. Name the new instance: verve-db-restore-YYYYMMDD
4. Click Confirm
5. Wait for the new instance to reach "Available" status (15–45 minutes)

Step 3 — Extract the restored database URL
───────────────────────────────────────────
1. In the new instance, go to "Connect"
2. Copy the "External Database URL" (postgresql://...)
3. Save this as RESTORED_DATABASE_URL for the verification step below
```

### 3.3 Verify the restored database

Connect to the restored instance and run data-integrity checks:

```bash
# Set the restored URL
export RESTORED_DATABASE_URL="postgresql://<restored-host>/<dbname>"

# 1. Confirm schema migrations match expected state
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT id, applied_at FROM schema_migrations ORDER BY applied_at;"
# Expected: All 16 migrations listed (003_users_schema through 018_supplier_catalogue_schema)

# 2. Confirm migration count exactly
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT COUNT(*) AS migration_count FROM schema_migrations;"
# Expected: 16

# 3. Confirm clinic data is present
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT id, name, created_at FROM clinics ORDER BY created_at LIMIT 10;"

# 4. Confirm user accounts are present
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT id, email, role, home_clinic_id FROM users ORDER BY created_at LIMIT 10;"

# 5. Confirm row counts for key tables are plausible
#    NOTE: correct table names are clinic_inventory_items and roster_entries
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT
     (SELECT COUNT(*) FROM clinics)                  AS clinics,
     (SELECT COUNT(*) FROM users)                    AS users,
     (SELECT COUNT(*) FROM clinic_inventory_items)   AS inventory_items,
     (SELECT COUNT(*) FROM roster_entries)           AS roster_entries,
     (SELECT COUNT(*) FROM timesheet_entries)        AS timesheet_entries,
     (SELECT COUNT(*) FROM suppliers)                AS suppliers,
     (SELECT COUNT(*) FROM supplier_catalogue)       AS supplier_catalogue,
     (SELECT COUNT(*) FROM audit_events)             AS audit_events;"

# 6. Confirm RLS policies are present
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;"
# Expected: tenant_isolation policies on all 14 tenant-scoped tables

# 7. Confirm the RLS helper functions exist
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT proname FROM pg_proc WHERE proname IN ('app_current_clinic_id', 'app_is_owner_admin');"
# Expected: 2 rows
```

If all checks pass, proceed to cutover. If checks fail, **stop** — escalate before proceeding.

### 3.4 Cutover to restored database

```bash
# In the Render dashboard:
# 1. Navigate to: Services → verve-dental-api → Environment
# 2. Update DATABASE_URL to point to the restored instance:
#      postgresql://<restored-host>/<dbname>?sslmode=require
# 3. Save changes
# 4. Trigger a manual redeploy of the backend service
# 5. Watch deploy logs for:
#      ✓ "Bootstrap migrations: all X migrations already applied"
#      ✓ "Server listening on 0.0.0.0:<PORT>"

# 6. Verify readiness
curl -s https://verve-dental-api.onrender.com/api/v1/ready | jq '.status, .checks.database'
# Expected: "ok"  { "status": "ok", "latencyMs": <n> }
```

### 3.5 Decommission the old instance

Only after confirming the application is healthy on the restored database:

```
1. In Render dashboard: Navigate to the OLD PostgreSQL instance
2. Verify it has no active connections:
   psql "$OLD_DATABASE_URL" -c "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = '<dbname>';"
3. Take a final manual export for archival:
   pg_dump "$OLD_DATABASE_URL" --format=custom --file=verve-pre-restore-archive-YYYYMMDD.dump
4. Store the .dump file in a secure location (encrypted storage, not git)
5. Delete the old Render PostgreSQL instance
```

### 3.6 Restore from pg_dump (manual backup)

If a manual `pg_dump` export exists:

```bash
# Restore to an empty database
createdb verve_restored
pg_restore \
  --format=custom \
  --dbname="postgresql://<user>:<pass>@<host>:5432/verve_restored" \
  --no-owner \
  --role=<app-user> \
  verve-backup-YYYYMMDD.dump

# After restore, re-apply any migrations that post-date the dump:
export DATABASE_URL="postgresql://<restored-url>"
npm run migrate --workspace=@verve/backend
```

---

## 4. Redis Recovery

> Redis stores only **refresh tokens** (session data). Data loss means all active sessions are invalidated — users must log in again. No business data is affected.

### 4.1 Recovery procedure

```bash
# Step 1 — If Redis is down, verify the application is still accepting new logins
curl -s https://verve-dental-api.onrender.com/api/v1/ready | jq '.checks.redis'
# "degraded" is acceptable for short periods

# Step 2 — Resume/restart Redis from the Render (or Upstash) dashboard
# No data restore is needed — the store is intentionally ephemeral

# Step 3 — Verify Redis reconnects automatically (ioredis retries on reconnect)
curl -s https://verve-dental-api.onrender.com/api/v1/ready | jq '.checks.redis'
# Expected: { "status": "ok", "latencyMs": <n> }

# Step 4 — Notify users that they will need to log in again
# (Active refresh tokens issued before the Redis outage are invalidated)
```

### 4.2 What is lost

| Item | Lost? | Impact |
|------|-------|--------|
| Refresh tokens | Yes | Users must re-authenticate |
| Active sessions | Yes | Existing access tokens expire naturally (15 min TTL) |
| Business data | **No** | None — Redis holds no business data |
| Audit history | **No** | Stored in PostgreSQL |

---

## 5. Application Redeployment

### 5.1 Backend redeployment (Render)

```bash
# Option A — Trigger redeploy via Render dashboard
# Services → verve-dental-api → Manual Deploy → Deploy latest commit

# Option B — Push to main branch (auto-deploy if configured)
git push origin main

# Option C — Render CLI
render deploys create --service <backend-service-id>

# Monitor startup phases in Render deploy logs:
# Phase 1: "Env validation passed"
# Phase 2: "Bootstrap migrations: X/X applied" | "Dependency bootstrap complete"
# Phase 3: "Server listening on 0.0.0.0:<PORT>"
```

### 5.2 Frontend redeployment (Render)

```bash
# Option A — Render dashboard
# Services → verve-dental-frontend → Manual Deploy → Deploy latest commit

# Option B — Push to main branch
git push origin main

# Verify: open https://verve-dental-frontend.onrender.com
# The frontend is a static build (Vite); no state is lost on redeploy
```

### 5.3 Schema reapplication (fresh database only)

If restoring to a completely empty PostgreSQL database (e.g., after spinning up a new instance):

```bash
# Ensure DATABASE_URL points to the new empty database
export DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<dbname>?sslmode=require"

# Apply all 16 bootstrap migrations (003_users_schema through 018_supplier_catalogue_schema)
npm run migrate --workspace=@verve/backend

# Confirm all 16 migrations applied
psql "$DATABASE_URL" -c "SELECT id, applied_at FROM schema_migrations ORDER BY applied_at;"
# Expected: 16 rows
```

---

## 6. Environment Variable Recovery

> Environment variables are not stored in this repository. They must be recovered from a secure secrets store or documented out-of-band.

### 6.1 Required variables for production

| Variable | Source | Notes |
|----------|--------|-------|
| `NODE_ENV` | Set to `production` | Hardcoded in deploy config |
| `PORT` | Injected by Render | Do not override |
| `HOST` | `0.0.0.0` | Required for Render |
| `DATABASE_URL` | Render PostgreSQL "Connect" tab | Rotates if DB is re-created |
| `DATABASE_SSL` | `auto` | Default is correct for Render |
| `REDIS_URL` | Redis provider "Connect" details | Format: `rediss://:<pass>@<host>:<port>` |
| `REDIS_TLS` | `auto` | Default is correct for `rediss://` URLs |
| `JWT_ACCESS_SECRET` | Secrets manager / secure vault | Min 32 chars; never commit to git |
| `JWT_REFRESH_SECRET` | Secrets manager / secure vault | Min 32 chars; never commit to git |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Default; can be kept in config |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Default; can be kept in config |
| `MFA_ENCRYPTION_KEY` | Secrets manager / secure vault | 64-char hex; losing this breaks TOTP decrypt |
| `CORS_ORIGIN` | Render env / deploy config | Must match frontend URL exactly |
| `MIGRATE_ON_STARTUP` | Set to `true` only for migration deploys | Leave unset (false) otherwise |

### 6.2 Regenerating lost secrets

```bash
# Regenerate JWT secrets (if lost)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Run twice — once for JWT_ACCESS_SECRET, once for JWT_REFRESH_SECRET

# Regenerate MFA_ENCRYPTION_KEY (if lost)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **CRITICAL WARNING:** If `MFA_ENCRYPTION_KEY` is lost and TOTP secrets are stored (encrypted) in PostgreSQL, all users with MFA enabled will be **permanently locked out** of their accounts. There is no decryption path without the original key. Back up this key independently of the database.

### 6.3 Frontend environment variables

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_API_BASE_URL` | `https://verve-dental-api.onrender.com` | Update if backend URL changes |

---

## 7. Full Recovery Checklist

Use this checklist end-to-end for a complete disaster recovery exercise.

### Pre-recovery

- [ ] Declare incident — notify stakeholders of estimated RTO
- [ ] Identify nature of failure (data corruption, provider outage, accidental deletion)
- [ ] Identify the last known good state (timestamp, backup snapshot label)
- [ ] Confirm who is performing the restore (DBA / Lead Engineer)
- [ ] Open a dedicated incident channel/thread for coordination

### PostgreSQL recovery

- [ ] Log in to Render dashboard with Owner/Admin access
- [ ] Navigate to the PostgreSQL instance → Backups tab
- [ ] Identify target snapshot (most recent before incident)
- [ ] Restore to a **new** database instance (do not overwrite live until verified)
- [ ] Wait for new instance to reach "Available" state
- [ ] Run Section 3.3 verification queries against restored instance
- [ ] Confirm row counts match expectations (clinics, users, inventory, roster, suppliers, supplier_catalogue)
- [ ] Confirm all **16** schema migrations are present in `schema_migrations` (003 through 018)
- [ ] Confirm RLS policies are present (`pg_policies`) — at least 20 policies expected
- [ ] Confirm `app_current_clinic_id` and `app_is_owner_admin` functions present
- [ ] Update `DATABASE_URL` in Render backend service environment
- [ ] Trigger backend redeploy
- [ ] Confirm backend readiness: `GET /api/v1/ready` returns `200 ok`

### Redis recovery

- [ ] Confirm Redis is running and responding to PING
- [ ] If Redis was lost: no data recovery needed — Redis is ephemeral
- [ ] Confirm `GET /api/v1/ready` shows `checks.redis.status: "ok"`
- [ ] Notify affected users that re-authentication is required

### Backend deployment

- [ ] Confirm `NODE_ENV=production` is set
- [ ] Confirm `DATABASE_URL` points to recovered database
- [ ] Confirm `REDIS_URL` is set and reachable
- [ ] Confirm `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are set (≥32 chars each)
- [ ] Confirm `MFA_ENCRYPTION_KEY` is the **original** key (not regenerated, unless TOTP recovery also performed)
- [ ] Confirm `CORS_ORIGIN` matches the frontend URL
- [ ] Trigger redeploy and confirm healthy startup in deploy logs
- [ ] Verify `GET /api/v1/health` → `200 ok`
- [ ] Verify `GET /api/v1/ready` → `200 ok` with all checks green

### Frontend deployment

- [ ] Confirm `VITE_API_BASE_URL` points to the correct backend URL
- [ ] Trigger frontend redeploy if URL changed
- [ ] Confirm frontend loads without console errors
- [ ] Confirm frontend can successfully reach the backend (login page visible)

### End-to-end smoke test

- [ ] Log in with a known admin account — confirm JWT is issued
- [ ] Confirm clinic data is visible (inventory, roster, etc.)
- [ ] Confirm supplier list is visible (`GET /api/v1/suppliers`)
- [ ] Confirm forecast endpoints respond (`GET /api/v1/forecast/materials`)
- [ ] Confirm MFA-enrolled users can complete TOTP challenge (requires original `MFA_ENCRYPTION_KEY`)
- [ ] Confirm token refresh works (re-use session after 15 min)
- [ ] Confirm logout works

### Post-recovery

- [ ] Update incident record with actual RTO achieved
- [ ] Document data loss window (actual RPO)
- [ ] Notify stakeholders that service is restored
- [ ] Schedule post-mortem within 48 hours
- [ ] Review gap analysis and prioritise remediations from Section 8

---

## 8. Gap Analysis

### 8.1 Missing backup protections

| Gap | Severity | Detail |
|-----|----------|--------|
| No automated backup verification | **HIGH** | Render snapshots are never tested for restorability — the first restore attempt may fail or produce corrupt data without prior validation. |
| No Point-in-Time Recovery (PITR) on free/starter plan | **HIGH** | Daily snapshots mean up to 24 hours of data loss. Any transaction after the last snapshot is unrecoverable. |
| No cross-region or offsite backup copy | **HIGH** | Render stores backups in the same cloud region. A provider-level regional failure destroys both the primary DB and its backups. |
| `MFA_ENCRYPTION_KEY` has no backup procedure | **HIGH** | Loss of this key permanently locks out all MFA-enrolled users. No recovery path exists without it. |
| No `render.yaml` / Infrastructure-as-Code | **MEDIUM** | Render service configuration lives only in the dashboard. Recreating services after a catastrophic account loss requires manual reconfiguration. |
| No export/archive schedule for `pg_dump` | **MEDIUM** | There is no scheduled process to produce portable backup files independent of Render's snapshot mechanism. |
| No secrets manager integration | **MEDIUM** | `.env.example` references AWS Secrets Manager, but no integration exists in code. Secrets are managed manually in the Render dashboard. If the Render account is compromised or locked, all secrets may be inaccessible. |
| Redis has no persistence config | **LOW** | Intentional — Redis is ephemeral. Acceptable data loss. |

### 8.2 Manual recovery steps (single points of failure)

| Step | Severity | Detail |
|------|----------|--------|
| Render dashboard access required for all restore operations | **HIGH** | No CLI or API-based restore available for managed PostgreSQL on Render. If the Render account is inaccessible, restore cannot proceed. |
| `DATABASE_URL` must be manually updated after restore | **MEDIUM** | No automation rotates the app's database URL when a restore creates a new instance. Human error risk during an already stressful incident. |
| No automated failover or standby replica | **HIGH** | There is no read replica or hot standby. A primary DB failure means full service outage until the restore completes. |
| Environment variable recovery is entirely manual | **MEDIUM** | There is no documented out-of-band secrets backup. If the Render dashboard is unavailable, secrets cannot be recovered. |
| Migration state must be manually verified post-restore | **LOW** | `npm run migrate` is idempotent and safe, but requires a human to run it after restore to a clean instance. |

### 8.3 Recovery risks

| Risk | Severity | Likelihood | Detail |
|------|----------|-----------|--------|
| Backup silent corruption | **HIGH** | Low | Render snapshots have never been test-restored in this project. Corrupt snapshots would only be discovered during an incident. |
| Key rotation invalidates TOTP for all users | **HIGH** | Medium | Regenerating `MFA_ENCRYPTION_KEY` (e.g., during a security incident) renders all stored TOTP secrets unreadable. |
| Free-tier DB auto-suspension | **HIGH** | Medium | Render free PostgreSQL suspends after 90 days inactive and deletes after 6 months. If this occurs, backups may also be lost. |
| RPO mismatch with clinic data criticality | **MEDIUM** | High | Dental clinics record patient visits, billing, and payroll daily. A 24-hour RPO means a full day of clinic records could be lost. This may not be acceptable for commercial use. |
| RTO exceeds clinic operating hours | **MEDIUM** | Medium | A 2-hour recovery window during business hours means clinic staff cannot operate for up to 2 hours. |
| Render account lockout | **MEDIUM** | Low | If the Render account owner is unavailable or locked out, no recovery operations can proceed. |

---

## 9. Operational Readiness Review

### 9.1 Backup maturity score

| Category | Weight | Score (0–10) | Weighted |
|----------|--------|-------------|---------|
| Backup existence & automation | 25% | 5 | 12.5 |
| Backup testability & verification | 20% | 1 | 2.0 |
| RPO achievability | 15% | 3 | 4.5 |
| RTO achievability | 15% | 4 | 6.0 |
| Documentation completeness | 10% | 7 | 7.0 |
| Secrets & key management | 10% | 2 | 2.0 |
| Cross-region / offsite resilience | 5% | 0 | 0.0 |
| **TOTAL** | **100%** | — | **34 / 100** |

**Current backup maturity score: 34 / 100**

#### Score rationale

- **Backup existence (5/10):** Render daily snapshots exist but are never tested, have no offsite copy, and rely entirely on a single provider.
- **Backup testability (1/10):** No restore drill has ever been performed. No automated verification. A corrupt backup would only be discovered during an actual incident.
- **RPO (3/10):** 24-hour RPO is inadequate for daily clinical operations without PITR.
- **RTO (4/10):** Manual restore via dashboard with no automation. 45–120 min RTO is high for a clinic-facing system.
- **Documentation (7/10):** This runbook and related runbooks provide reasonable procedural coverage. Gaps remain around actual Render service IDs and specific account recovery contacts.
- **Secrets management (2/10):** No secrets manager integration. Manual Render dashboard management. `MFA_ENCRYPTION_KEY` has no documented backup procedure.
- **Cross-region (0/10):** No cross-region, no read replicas, no offsite backup copy.

---

### 9.2 Internal pilot readiness

**Verdict: CONDITIONALLY READY**

The current state is acceptable for an **internal team pilot** (≤20 users, non-patient-facing) with the following conditions:

- [ ] Confirm the Render PostgreSQL plan is at minimum **Starter** (not free tier) to avoid auto-suspension.
- [ ] Perform at least **one manual restore drill** before pilot launch — see [restore-drill.md](./restore-drill.md) Part B.
- [ ] Store `MFA_ENCRYPTION_KEY` and JWT secrets in a second location (password manager or encrypted note accessible to more than one person).
- [ ] Add a second Render Owner/Admin to the account.
- [ ] Brief the pilot team: in the event of data loss, up to 24 hours of data may be unrecoverable.

See [restore-drill.md](./restore-drill.md) for the complete pilot go/no-go criteria (Part H) and restore drill procedure (Part B).

---

### 9.3 Commercial readiness

**Verdict: NOT READY**

The following must be resolved before commercial launch with clinic customers:

| Requirement | Priority | Estimated effort |
|------------|----------|-----------------|
| Upgrade to Render Standard plan to enable PITR (target RPO ≤1 hour) | **P0** | Low — plan upgrade only |
| Perform and document monthly restore drill | **P0** | Low — 1–2 hours/month |
| Back up `MFA_ENCRYPTION_KEY` and JWT secrets to AWS Secrets Manager or equivalent | **P0** | Medium — ~1 day |
| Add `render.yaml` Infrastructure-as-Code for service configuration | **P1** | Medium — ~1 day |
| Add scheduled `pg_dump` export to S3 / offsite storage (daily, 30-day retention) | **P1** | Medium — ~1–2 days |
| Define and document SLA for RPO/RTO in customer agreements | **P1** | Low — documentation |
| Implement backup verification automation (restore-and-check on weekly schedule) | **P2** | High — ~3–5 days |
| Consider read replica or Render HA PostgreSQL for zero-downtime failover | **P2** | Medium — ~1–2 days |

---

## 10. Escalation

| When | Escalate to |
|------|-------------|
| Data loss confirmed or suspected | Database Administrator / Lead Engineer — initiate this runbook immediately |
| Render snapshot restore fails | Render Support (https://render.com/support) + Lead Engineer |
| `MFA_ENCRYPTION_KEY` lost — TOTP locked out | Lead Engineer + affected users — requires account recovery flow |
| RTO threshold exceeded (>2 hours) | Incident Commander — consider clinic staff workaround (manual paper records) |
| Render account inaccessible | Company Director / Account Owner — account recovery via Render |
| Data loss exceeds RPO (>24 hours lost) | Incident Commander + Legal/Compliance review |
| All backups found corrupt | Render Support + engage independent data recovery specialist |

---

## Related runbooks

- [Restore Drill & Recovery Verification](./restore-drill.md) ← Sprint K.1 deliverable
- [Database Unavailable](./database-down.md)
- [Redis Unavailable](./redis-down.md)
- [Deployment Failure](./deployment-failure.md)

---

*This document was originally produced as part of Sprint K — Backup & Restore Validation. Updated in Sprint K.1 to reflect Sprint O.2 schema additions (16 migrations, suppliers tables) and correct verification query table names.*
