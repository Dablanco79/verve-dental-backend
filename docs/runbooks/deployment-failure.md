# Runbook: Deployment Failure

**Service:** Verve Operational Suite — Backend API  
**Severity:** P1 — Critical (new version not serving traffic) / P2 — High (rollback in progress)  
**Last reviewed:** 2026-06-18

---

## Symptoms

| Signal | Detail |
|--------|--------|
| New deploy never reaches healthy state | Healthcheck on `/api/v1/health` times out or returns non-200 |
| Deploy log shows `process.exit(1)` | Startup phase failed (env validation or infrastructure bootstrap) |
| `GET /api/v1/ready` returns `503` | Readiness probe failing; process is alive but not ready |
| Previous version still serving traffic | PaaS rolled back or kept old instance alive |
| No traffic reaching the new deploy | Load balancer removed pod/dyno from rotation |

---

## Startup failure phases

The application starts in three sequential phases. Each phase has distinct failure signatures:

| Phase | Log field `stage` | Failure cause |
|-------|-------------------|---------------|
| 1 — Env validation | `env-validation` | Missing / invalid env var (Zod schema) |
| 2 — Infrastructure | `dependency-bootstrap` | DB/Redis unreachable or misconfigured |
| 3 — HTTP server | _(no structured field)_ | Port already bound, OS limit hit |

Look for these log patterns:

```json
{ "level": "fatal", "phase": "startup", "stage": "env-validation",
  "msg": "Invalid environment configuration: …" }

{ "level": "fatal", "phase": "startup", "stage": "dependency-bootstrap",
  "msg": "Startup failed — required infrastructure is unavailable …" }
```

---

## Diagnostic steps

### 1. Read the deploy log immediately

Most PaaS platforms (Render, Railway, Fly.io) stream stdout/stderr during the deploy.  
Look for:
- `FATAL` or `fatal` level log entries
- `process.exit(1)` or a non-zero exit code
- The `stage` field in the structured JSON log output

### 2. Check environment variables

The most common cause of startup failure is a missing or malformed environment variable.

**Required in all environments:**

| Variable | Constraint |
|----------|------------|
| `JWT_ACCESS_SECRET` | min 32 characters |
| `JWT_REFRESH_SECRET` | min 32 characters |
| `MFA_ENCRYPTION_KEY` | 64-character hex string (32 bytes) |

**Required in staging and production:**

| Variable | Constraint |
|----------|------------|
| `DATABASE_URL` | valid `postgresql://` URL |
| `REDIS_URL` | valid `redis://` or `rediss://` URL |
| `CORS_ORIGIN` | HTTPS URL(s), no wildcard |

```bash
# Generate a valid MFA encryption key if missing:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT secrets:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Test infrastructure connectivity

Before deploying, confirm the new host/region can reach DB and Redis:

```bash
# From the deploy environment (e.g., a one-off Render job):
psql "$DATABASE_URL" -c "SELECT 1;"
redis-cli -u "$REDIS_URL" PING
```

### 4. Check liveness and readiness

If the process started but is not receiving traffic:

```bash
# Replace <new-instance-url> with the direct URL of the new deploy
curl -v https://<new-instance-url>/api/v1/ready
```

- `/api/v1/health` is liveness only.
- `/api/v1/ready` reports PostgreSQL as critical and Redis as noncritical.
- A readiness response, including a degraded response, does not prove login,
  refresh-token persistence, logout, or clinic workflows work. These are
  separate release-acceptance checks.

### 5. Check migration state

Keep `MIGRATE_ON_STARTUP=false`. Normal deployed startup checks migration state
and blocks if migrations are pending.

```powershell
# Run from the repository root in a separate CLI process.
npm.cmd run migrate --workspace=@verve/backend

# Require exit code 0, then repeat and confirm zero pending migrations.
```

See [Backend migrations](../../Backend/migrations/README.md). Never run
`test:db:setup` against hosted Staging or Production.

---

## Resolution

### A — Environment variable missing or invalid

1. Add or correct the variable in your PaaS dashboard / Vault / SSM.
2. Trigger a new deploy.
3. Do **not** re-use the same deploy — secrets may have been partially written.

### B — Database unreachable from new deployment region

1. Add the new deployment's egress IP to the DB's IP allowlist.
2. Verify private networking is configured (Render private services, Railway private network, etc.).
3. See [database-down.md](./database-down.md) for full diagnostics.

### C — Redis unreachable

1. Verify the Redis instance is running and accepting connections.
2. See [redis-down.md](./redis-down.md) for full diagnostics.

### D — Migration failure blocked startup

```bash
# Connect directly to the database and inspect the migrations table:
psql "$DATABASE_URL" -c "SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;"

# If a migration is stuck in a partial state, roll it back manually:
# (Requires DBA involvement — consult the migration file for the rollback SQL)
```

### E — Port conflict (rare on PaaS)

The process binds to `$PORT` (default 3000). If another process holds the port:

```bash
lsof -i :3000
kill -9 <pid>
```

---

## Rollback procedure

1. Stop promotion and record the failing and last-known-good full SHAs.
2. Determine whether database migrations ran.
3. If the schema did not change, manually deploy the verified full
   last-known-good SHA with auto-deploy still off.
4. If migrations ran, review the older application's compatibility with the
   current schema and data before deploying it.
5. Application rollback is unsafe if the older code depends on removed or
   renamed columns, incompatible constraints or types, or pre-migration data
   semantics.
6. Do not automatically run reference down migrations and do not force-push
   tags. If compatibility is not demonstrated, use the approved backup/restore
   plan and obtain the required database/release approval.

Application rollback leaves `schema_migrations` and all migrated data in place.
See [Release Promotion](./release-promotion.md) and
[Backup & Restore](./backup-restore.md).

---

## Post-incident verification

After the deploy succeeds or an approved rollback completes, perform liveness,
readiness, and release acceptance:

```bash
# 1. Liveness
curl -s https://<host>/api/v1/health | jq .status
# Expected: "ok"

# 2. Readiness
curl -s https://<host>/api/v1/ready | jq '.status, .checks'
# Expected: "ok" with all checks green

# 3. Auth smoke test
curl -s -X POST https://<host>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<smoke-test-user>","password":"<password>"}' | jq .data.requiresMfa
```

Also verify MFA where required, refresh rotation, browser-reload persistence,
logout cookie clearing, post-logout reload, tenant isolation, and critical
clinic workflows.

---

## Prevention checklist

Before deploying to staging or production:

- [ ] `npm.cmd run lint` passes with no errors
- [ ] `npm.cmd run typecheck` passes
- [ ] `npm.cmd run build` succeeds
- [ ] `npm.cmd test` passes
- [ ] All required env vars are set in the target environment
- [ ] `DATABASE_URL` connectivity has been verified from the target host
- [ ] `REDIS_URL` connectivity has been verified from the target host
- [ ] Pending database migrations have been reviewed and are reversible
- [ ] `MIGRATE_ON_STARTUP=false` remains set
- [ ] Standalone migration process exited successfully and repeated with zero pending migrations
- [ ] Backup availability and restore capability were verified, not assumed
- [ ] The immutable full SHA is recorded for every applicable service

---

## Escalation

| When | Escalate to |
|------|-------------|
| Rollback fails to restore service | Lead Engineer |
| Data loss suspected during migration failure | Database Administrator |
| Outage > 30 minutes | Incident Commander |
| Security-related deployment (secrets rotation, auth changes) | Security Lead |

---

## Related runbooks

- [Database Unavailable](./database-down.md)
- [Redis Unavailable](./redis-down.md)
