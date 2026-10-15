# Runbook: Backup & Restore

**Service:** Verve Operational Suite — Full Stack  
**Severity:** P1 — Critical (data recovery scenario)  
**Last reviewed:** 2026-10-13
**Release:** Post Sprint O.2

> **Infrastructure review 2026-10-13:** Provider backup features, retention,
> restore controls, plan tier, RPO, and RTO are unverified. Historical provider
> examples below are planning context only and must not be executed or treated
> as evidence until reconciled with current provider documentation and a
> successful isolated restore drill. The authoritative release sequence is
> [Release Promotion](./release-promotion.md).

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

No backup automation or provider configuration is defined in this repository.
The actual Production plan, backup schedule, retention, encryption, restore
interface, point-in-time recovery, and regional isolation have not been
verified. Do not promise any of these capabilities from this runbook.

Before a release that changes schema or data, an authorised operator must check
the current provider/account configuration, record dated evidence, and prove
the selected recovery method in a non-production restore drill.

---

### 1.3 Redis backup

Redis on Render (or Upstash/Railway equivalent) stores **only refresh tokens** — ephemeral session data. Redis data loss requires all users to log in again; no business data is lost. No backup of Redis is required or recommended.

---

### 1.4 Migrations are not a data backup

`Backend/src/db/migrate.ts` defines the current embedded migration sequence and
`schema_migrations` records applied IDs. Do not hard-code a migration count or
final ID in recovery checks. The standalone migration command can construct the
current schema on a clean database, but it cannot recover business data,
secrets, or provider configuration and is not a substitute for a tested backup.

---

## 2. Recovery Objectives

### 2.1 Definitions

| Term | Definition |
|------|-----------|
| **RPO** (Recovery Point Objective) | Maximum acceptable data loss measured in time — how far back in time the restored data may be |
| **RTO** (Recovery Time Objective) | Maximum acceptable downtime — how long recovery is allowed to take before service is restored |

### 2.2 Current RPO

Unverified. The repository contains no evidence of the active backup schedule,
retention, or point-in-time recovery capability. Redis loss invalidates sessions
but does not define the PostgreSQL RPO.

### 2.3 Current RTO

Unverified. Measure it through an end-to-end restore drill; do not publish
component or total recovery times based on provider assumptions.

### 2.4 Targets

| Tier | Target RPO | Target RTO | Enables |
|------|-----------|-----------|---------|
| Internal pilot (current) | 24 hours | 2 hours | Acceptable for internal team testing |
| Early commercial (near-term) | 1 hour | 30 min | Requires Render Standard + PITR |
| Production SLA (future) | 15 min | 15 min | Requires PITR + automated failover + runbook drills |

These are proposals, not achieved objectives. They require stakeholder approval,
verified provider capabilities, and measured restore evidence.

---

## 3. PostgreSQL Restore Procedure

> **When to use:** Data corruption, accidental deletion, provider-level failure, or any scenario where the live database cannot be trusted.

### 3.1 Prerequisites

- Authorised provider access and an independently stored, approved secrets source.
- Dated evidence of the provider's actual backup and restore capabilities.
- A recovery point selected against the incident timeline.
- A new, isolated restore target; never overwrite live data for a test.
- Pre-restore row counts, migration IDs, RLS expectations, and acceptance plan.
- A schema-compatibility decision for the application SHA to be deployed.

### 3.2 Restore using the verified provider procedure

The repository cannot verify which restore controls the active provider plan
offers. The following historical dashboard outline is not authority to perform
a restore. Before using it, reconcile every step with current provider
documentation and a previously successful drill. Record the operator, source
recovery point, isolated target, times, and result. Do not change Production
connection settings until validation and approval are complete.

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
# Expected: IDs match the reviewed release source and pre-restore evidence

# 2. Confirm migration count exactly
psql "$RESTORED_DATABASE_URL" -c \
  "SELECT COUNT(*) AS migration_count FROM schema_migrations;"
# Expected: count matches the reviewed release source and pre-restore evidence
```

Validate business tables as the application database role. For every scoped
query, start a transaction and set the source-verified transaction-local
`app.current_clinic_id`, `app.owner_admin_mode`, and `app.current_user_id`
values using the pattern in `Backend/src/db/tenantContext.ts`; roll back after
the check. Use owner-admin mode only for approved cross-clinic inventory, then
repeat representative checks under non-owner clinic contexts.

An unscoped zero count may be caused by forced RLS and is not proof of data
loss. Policy counts, helper-function presence, and catalog flags are useful
schema evidence but are not proof that isolation works.

Using a user without owner-admin or cross-clinic privileges, verify allowed
reads and writes in that user's clinic, then attempt equivalent operations
against another clinic with known data. Require denial or an empty
tenant-scoped result, as appropriate, and confirm no cross-clinic write
occurred.

If all checks pass, proceed to cutover. If checks fail, **stop** — escalate before proceeding.

### 3.4 Cutover to restored database

```bash
# Before changing configuration, record and confirm:
#   TARGET_ENVIRONMENT = <intended Staging, Production, or isolated drill target>
#   TARGET_API_SERVICE = <provider service name/ID>
#   TARGET_API_BASE_URL = <HTTPS API origin for that environment>
#
# In the provider dashboard:
# 1. Navigate to: Services → <TARGET_API_SERVICE> → Environment
# 2. Update DATABASE_URL to point to the restored instance:
#      postgresql://<restored-host>/<dbname>?sslmode=require
# 3. Save changes
# 4. Trigger a manual redeploy of the backend service
# 5. Watch deploy logs for:
#      ✓ "Migration check: 0 pending"
#      ✓ "No pending migrations — schema is up to date"
#      ✓ "Server listening on 0.0.0.0:<PORT>"

# 6. Reconfirm TARGET_API_BASE_URL identifies TARGET_ENVIRONMENT, then verify:
curl -s <TARGET_API_BASE_URL>/api/v1/ready | jq '.status, .checks.database'
# Expected: "ok"  { "status": "ok", "latencyMs": <n> }
```

### 3.5 Abort or cut back before decommissioning

If validation fails after an application was pointed at the restore target:

1. Stop application writes before changing database configuration.
2. Determine whether the original database, restored database, or both accepted
   writes after the switch.
3. Use timestamps, audit evidence, and application-role RLS-aware checks to
   assess divergence.
4. Require an explicit incident-owner decision naming the authoritative
   database and addressing reconciliation, conflicts, duplicates, and accepted
   data loss.
5. Only then point `<TARGET_API_SERVICE>` at the approved database and redeploy
   the last schema-compatible full SHA.
6. Confirm `<TARGET_API_BASE_URL>` identifies the intended environment before
   repeating liveness, readiness, authentication and workflow acceptance.

Preserve both databases until the authoritative-data decision, reconciliation,
incident review, and retention approval are complete.

### 3.6 Retention and later decommissioning

Database deletion is not a routine validation, cutback, or drill-cleanup step.
Consider decommissioning only through a separate approved change after the
authoritative database is documented, reconciliation is complete, retention
requirements are satisfied, and recovery evidence has been preserved.

### 3.7 Restore from pg_dump (manual backup)

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
```

After the restore, use a Windows PowerShell process with `DATABASE_URL`
supplied through the approved secret mechanism:

```powershell
# Run from the repository root; do not print DATABASE_URL.
npm.cmd run migrate --workspace=@verve/backend
```

---

## 4. Redis Recovery

> Redis stores only **refresh tokens** (session data). Data loss means all active sessions are invalidated — users must log in again. No business data is affected.

### 4.1 Recovery procedure

```bash
# First confirm TARGET_API_BASE_URL identifies the intended environment.
# Step 1 — If Redis is down, inspect readiness:
curl -s <TARGET_API_BASE_URL>/api/v1/ready | jq '.checks.redis'
# A degraded readiness result is not authentication acceptance.

# Step 2 — Resume/restart Redis from the Render (or Upstash) dashboard
# No data restore is needed — the store is intentionally ephemeral

# Step 3 — Verify Redis reconnects automatically (ioredis retries on reconnect)
curl -s <TARGET_API_BASE_URL>/api/v1/ready | jq '.checks.redis'
# Expected: { "status": "ok", "latencyMs": <n> }

# Step 4 — Verify fresh login, refresh rotation, logout and browser reload.
# Notify users that sessions issued before cache loss may require re-login.
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
# Production auto-deploy remains OFF.
# Manually deploy the immutable full SHA that passed Staging acceptance.
# Verify the full SHA in the service's deploy metadata.

# Monitor startup phases in Render deploy logs:
# Phase 1: "Env validation passed"
# Phase 2: "Bootstrap migrations: X/X applied" | "Dependency bootstrap complete"
# Phase 3: "Server listening on 0.0.0.0:<PORT>"
```

### 5.2 Frontend redeployment (Render)

```bash
# Production auto-deploy remains OFF.
# Manually deploy the same immutable full SHA tested in Staging.
# Verify the full SHA in the service's deploy metadata.

# Confirm TARGET_FRONTEND_URL belongs to the intended environment, then open it.
# Verify: open <TARGET_FRONTEND_URL>
# The frontend is a static build (Vite); no state is lost on redeploy
```

### 5.3 Schema reapplication (fresh database only)

If restoring to a completely empty PostgreSQL database (e.g., after spinning up a new instance):

```powershell
# From the repository root, with DATABASE_URL supplied through the approved
# secret mechanism and confirmed to identify the intended empty target:
npm.cmd run migrate --workspace=@verve/backend

# Require exit code 0, then run it again and confirm zero pending migrations.
psql $env:DATABASE_URL -c "SELECT id, applied_at FROM schema_migrations ORDER BY applied_at;"
# Expected IDs must match the reviewed release source.
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
| `MIGRATE_ON_STARTUP` | `false` | Migrations run only through the separate CLI process |

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
| `VITE_API_BASE_URL` | `<TARGET_API_BASE_URL>` | Confirm it belongs to the intended environment before building or testing |

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
- [ ] Run Section 3.3 validation against the restored instance as the application role with source-verified transaction-local RLS contexts
- [ ] Confirm scoped business data matches expectations; do not treat an unscoped zero count as proof of data loss
- [ ] Confirm `schema_migrations` IDs match the reviewed release source
- [ ] Treat RLS policy/helper inspection as supplemental schema evidence
- [ ] Behaviourally verify allowed same-clinic reads/writes and denied cross-clinic reads/writes with a user lacking cross-clinic privileges
- [ ] Update `DATABASE_URL` in Render backend service environment
- [ ] Trigger backend redeploy
- [ ] Confirm backend readiness: `GET /api/v1/ready` returns `200 ok`
- [ ] Separately verify login, mandatory MFA, refresh rotation, browser reload, logout, and post-logout reload

### Redis recovery

- [ ] Confirm Redis is running and responding to PING
- [ ] If Redis was lost: no data recovery needed — Redis is ephemeral
- [ ] Confirm `GET /api/v1/ready` shows `checks.redis.status: "ok"`
- [ ] Notify affected users that re-authentication is required

### Backend deployment

- [ ] Confirm `TARGET_ENVIRONMENT`, `TARGET_API_SERVICE`, `TARGET_API_BASE_URL`, and `TARGET_FRONTEND_URL` before changing configuration or running acceptance
- [ ] Confirm `NODE_ENV=production` is set
- [ ] Confirm `DATABASE_URL` points to recovered database
- [ ] Confirm `REDIS_URL` is set and reachable
- [ ] Confirm `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are set (≥32 chars each)
- [ ] Confirm `MFA_ENCRYPTION_KEY` is the **original** key (not regenerated, unless TOTP recovery also performed)
- [ ] Confirm `CORS_ORIGIN` matches the frontend URL
- [ ] Trigger redeploy and confirm healthy startup in deploy logs
- [ ] Verify `GET /api/v1/health` → `200 ok`
- [ ] Verify `GET /api/v1/ready` → `200 ok` with all checks green
- [ ] Treat liveness/readiness as infrastructure checks, not authentication acceptance

For an isolated restore-validation service, follow
[Restore Drill](./restore-drill.md) B.1: use drill-only JWT secrets, an isolated
cache, explicit drill API/frontend origins and CORS, and no Production refresh
storage. Review outbound integrations in the exact release SHA. Current source
includes Anthropic OCR; disable it or isolate it with restricted non-Production
credentials and egress controls. The original `MFA_ENCRYPTION_KEY` may be
required to test restored MFA data and must remain handled as a Production
secret—never printed or committed.

### Frontend deployment

- [ ] Confirm `VITE_API_BASE_URL` points to the correct backend URL
- [ ] Trigger frontend redeploy if URL changed
- [ ] Confirm frontend loads without console errors
- [ ] Confirm frontend can successfully reach the backend (login page visible)

### End-to-end smoke test

- [ ] Log in with a known admin account — confirm JWT is issued
- [ ] Confirm clinic data is visible (inventory, roster, etc.)
- [ ] Confirm supplier list is visible (`GET /api/v1/suppliers`)
- [ ] Confirm procurement workflows respond as expected
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

The provider-specific entries in Sections 8 and 9 are historical risk
hypotheses. Until current provider settings and a restore drill supply evidence,
read statements about snapshots, retention, plan features, RPO, RTO, and
regional design as unverified conditions—not current facts.

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
| Migration state must be manually verified post-restore | **LOW** | The standalone migration CLI is repeatable, but requires a successful exit and second zero-pending run. |

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

**Current backup maturity is unverified.** The historical score below was not
based on a completed restore drill and must not be used as release evidence.

#### Score rationale

The following bullets are the rationale for the historical score, not verified
current-state claims:

- **Backup existence (5/10):** Render daily snapshots exist but are never tested, have no offsite copy, and rely entirely on a single provider.
- **Backup testability (1/10):** No restore drill has ever been performed. No automated verification. A corrupt backup would only be discovered during an actual incident.
- **RPO (3/10):** 24-hour RPO is inadequate for daily clinical operations without PITR.
- **RTO (4/10):** Manual restore via dashboard with no automation. 45–120 min RTO is high for a clinic-facing system.
- **Documentation (7/10):** This runbook and related runbooks provide reasonable procedural coverage. Gaps remain around actual Render service IDs and specific account recovery contacts.
- **Secrets management (2/10):** No secrets manager integration. Manual Render dashboard management. `MFA_ENCRYPTION_KEY` has no documented backup procedure.
- **Cross-region (0/10):** No cross-region, no read replicas, no offsite backup copy.

---

### 9.2 Internal pilot readiness

**Verdict: NOT PROVEN**

The current state is **not approved** for an internal pilot. The following
conditions are necessary but do not automatically grant approval:

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

*Originally produced for Sprint K and reviewed on 2026-10-13. Migration
expectations must be derived from the immutable release source, not this
document.*
