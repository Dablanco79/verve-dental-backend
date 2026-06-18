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

### 4. Check the readiness endpoint on the new instance

If the process started but is not receiving traffic:

```bash
# Replace <new-instance-url> with the direct URL of the new deploy
curl -v https://<new-instance-url>/api/v1/ready
```

- `200 ok`: Process is ready — check load balancer / DNS configuration
- `503 unavailable`: DB + Redis both failing
- `200 degraded`: One dependency is down

### 5. Check migration state

If migrations are enabled (`MIGRATE_ON_STARTUP=true`), a failed migration blocks startup.

```bash
# Run migrations manually (in a one-off job against the target DB):
npm run migrate

# Review migration log output for errors
```

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

### Render

```bash
# Via CLI (if deployed)
render deploys rollback --service <service-id>

# Via Dashboard: Services → <service> → Deploys → select previous deploy → "Rollback"
```

### Railway

```bash
railway rollback
```

### Manual (any platform)

```bash
# Tag the last known-good image and redeploy:
git tag -f stable-rollback <last-good-commit-sha>
git push origin stable-rollback --force

# Then trigger a deploy from that tag in your PaaS dashboard
```

---

## Post-incident verification

After the deploy succeeds (or a rollback completes):

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

---

## Prevention checklist

Before deploying to staging or production:

- [ ] `npm run lint` passes with no errors
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (including coverage thresholds)
- [ ] All required env vars are set in the target environment
- [ ] `DATABASE_URL` connectivity has been verified from the target host
- [ ] `REDIS_URL` connectivity has been verified from the target host
- [ ] Pending database migrations have been reviewed and are reversible
- [ ] `MIGRATE_ON_STARTUP=true` is set if new migrations are included

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
