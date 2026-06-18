# Runbook: Database Unavailable

**Service:** Verve Operational Suite — Backend API  
**Severity:** P1 — Critical (all clinic business operations affected)  
**Last reviewed:** 2026-06-18

---

## Symptoms

| Signal | Detail |
|--------|--------|
| `GET /api/v1/ready` returns `503` | `checks.database.status` is `"error"` |
| Application logs | `"Startup failed — required infrastructure is unavailable"` |
| Application logs | `ECONNREFUSED` or `connection timeout` in log entries |
| Clinic staff unable to log in or view data | All authenticated routes return `500` or `503` |

---

## Diagnostic steps

### 1. Confirm the outage scope

```bash
# Check readiness endpoint
curl -s https://<host>/api/v1/ready | jq .

# Expected when degraded:
# { "status": "degraded", "checks": { "database": { "status": "error", ... } } }
```

### 2. Verify environment variable

```bash
# On the server / in your PaaS dashboard, confirm DATABASE_URL is set
echo $DATABASE_URL

# Must be a valid postgres:// or postgresql:// URL
# If empty → missing environment variable (see "Resolution — missing env var" below)
```

### 3. Test direct connectivity from the app host

```bash
# From within the container/dyno/VM running the API:
psql "$DATABASE_URL" -c "SELECT 1;"

# Possible outcomes:
#   Success          → DB is reachable; problem is elsewhere
#   "Connection refused" → DB host unreachable from this network
#   "SSL required"   → SSL mismatch; check DATABASE_SSL env var
#   "FATAL: role not found" → DB user/password wrong or role dropped
```

### 4. Check the database host directly

```bash
# Replace <db-host> and <db-port> with values from DATABASE_URL
nc -zv <db-host> <db-port>

# For managed services (Render, Railway, Supabase):
#   → Check the provider's status page
#   → Verify the database instance is not in a "sleeping" or "suspended" state
```

### 5. Inspect recent application logs

Look for these log fields:

```json
{ "phase": "startup", "stage": "dependency-bootstrap", "level": "fatal" }
{ "msg": "⚠️  Local PG DB not running — falling back to Mock/In-Memory mode" }
```

The first pattern means the process exited before serving traffic.  
The second means the process started in degraded mode (development only).

---

## Resolution

### A — Missing or incorrect `DATABASE_URL`

1. Set `DATABASE_URL` in your PaaS environment / Vault / SSM Parameter Store.
2. Format: `postgresql://user:password@host:5432/dbname?sslmode=require`
3. Redeploy / restart the dyno or container.
4. Verify: `GET /api/v1/ready` returns `200` with `checks.database.status: "ok"`.

### B — Database host unreachable (network issue)

1. Check firewall / security group rules:
   - The app host's egress IP must be in the DB's IP allowlist.
   - For Render/Railway: use their internal networking or private network feature.
2. For managed DB services: check the provider status page.
3. If the managed DB was paused/suspended, resume it from the provider dashboard.
4. Restart the API after resolving connectivity.

### C — Database process is down (self-hosted)

```bash
# Check PostgreSQL service status
systemctl status postgresql

# Restart if stopped
sudo systemctl restart postgresql

# Confirm it is accepting connections
pg_isready -h localhost -p 5432
```

### D — SSL/TLS handshake failure

```bash
# Set DATABASE_SSL=false for local testing, or DATABASE_SSL=true to force
# Check the sslmode parameter in DATABASE_URL:
#   sslmode=require     → DATABASE_SSL=auto works
#   sslmode=disable     → set DATABASE_SSL=false
#   sslmode=verify-full → ensure the CA cert chain is accessible
```

### E — Connection pool exhausted

Signs: `"remaining connection slots are reserved"` in logs.

1. Check `max` pool setting (currently: 20 in production, 10 otherwise).
2. Kill idle/long-running queries:
   ```sql
   SELECT pid, state, query, age(clock_timestamp(), query_start) AS age
   FROM pg_stat_activity
   WHERE datname = '<dbname>' ORDER BY age DESC;

   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE state = 'idle' AND age(clock_timestamp(), query_start) > interval '10 minutes';
   ```
3. Restart the API to reset the pool.

---

## Recovery verification

```bash
# 1. Readiness probe must return 200
curl -s https://<host>/api/v1/ready | jq '.status, .checks.database'
# Expected: "ok"  { "status": "ok", "latencyMs": <n> }

# 2. Auth smoke test
curl -s -X POST https://<host>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<password>"}' | jq .status
```

---

## Escalation

| When | Escalate to |
|------|-------------|
| DB process cannot be restarted | Database Administrator / Cloud Provider Support |
| Data loss suspected | Database Administrator — initiate backup restore procedure |
| Outage > 30 minutes | Incident Commander |

---

## Related runbooks

- [Redis Unavailable](./redis-down.md)
- [Deployment Failure](./deployment-failure.md)
