# Runbook: Redis Unavailable

**Service:** Verve Operational Suite — Backend API  
**Severity:** P2 — High (authentication/session management degraded; business data unaffected)  
**Last reviewed:** 2026-06-18

---

## Symptoms

| Signal | Detail |
|--------|--------|
| `GET /api/v1/ready` returns `200` with `status: "degraded"` | `checks.redis.status` is `"error"` |
| Application logs | `"⚠️  Local Redis not running — session caching disabled"` |
| Application logs | `Redis error: …` in pino-structured log entries |
| Users receiving `401 Unauthorized` on token refresh | Refresh tokens stored in Redis are unavailable |
| Users unable to log out from all devices | `revokeAllUserTokens` cannot reach Redis |

> **Note:** When `REDIS_URL` is not set (development/test), the API runs with an
> in-memory session store and the readiness probe reports `"ok"`.  
> This runbook applies to environments where `REDIS_URL` is configured (staging/production).

---

## Impact assessment

| Capability | With Redis down |
|------------|-----------------|
| Login (new session) | Unaffected — JWTs are issued regardless |
| Access token validation | Unaffected — validated via JWT signature |
| Token refresh | Degraded — refresh tokens cannot be verified |
| Logout (single device) | Degraded — token cannot be revoked from store |
| Logout (all devices) | Unavailable — requires Redis set operations |
| Rate limiting (if Redis-backed) | May bypass limits — depends on limiter config |

In production, Redis is required; the process refuses to start without it.

---

## Diagnostic steps

### 1. Confirm the outage scope

```bash
curl -s https://<host>/api/v1/ready | jq .

# Degraded:
# { "status": "degraded", "checks": { "redis": { "status": "error", ... } } }
```

### 2. Verify `REDIS_URL` is set

```bash
echo $REDIS_URL
# Must be redis:// or rediss:// URL
# Empty → missing env var (see Resolution A)
```

### 3. Test connectivity from the app host

```bash
# From inside the container/dyno:
redis-cli -u "$REDIS_URL" PING
# Expected: PONG
# "Connection refused" → network issue or Redis process down
# "NOAUTH" → authentication required; check password in REDIS_URL
```

### 4. Check application logs for error codes

```json
{ "msg": "Redis error: …", "level": "warn" }
{ "phase": "startup", "stage": "dependency-bootstrap", "level": "fatal" }
```

Fatal at startup means the API never came up (production environment).  
Warn during runtime means a runtime connection was lost after startup.

---

## Resolution

### A — Missing or incorrect `REDIS_URL`

1. Set `REDIS_URL` in your PaaS environment variables / Vault.
2. Format:
   - Plain: `redis://:password@host:6379`
   - TLS:   `rediss://:password@host:6380`
3. For TLS connections, ensure `REDIS_TLS=true` or use the `rediss://` scheme.
4. Redeploy / restart the process.

### B — Redis process is down (self-hosted)

```bash
# Check Redis service
systemctl status redis

# Restart
sudo systemctl restart redis

# Verify
redis-cli PING
```

### C — Managed Redis in a suspended/sleeping state

For Render, Railway, Upstash, or similar:
1. Open the provider dashboard.
2. Resume / wake the Redis instance.
3. Confirm the `REDIS_URL` has not changed (some providers rotate credentials on resume).
4. Restart the API after Redis is accepting connections.

### D — TLS handshake failure

```bash
# Test TLS directly
openssl s_client -connect <redis-host>:<port>

# If the cert is self-signed or from a private CA:
#   → Either add the CA cert to the trust store, or
#   → Set rejectUnauthorized: false (NOT recommended for production)
```

Check `REDIS_TLS` environment variable:
- `auto` (default): TLS is used only when `REDIS_URL` starts with `rediss://`
- `true`: force TLS regardless of scheme
- `false`: disable TLS

### E — Memory pressure (OOM)

```bash
redis-cli INFO memory | grep used_memory_human
redis-cli INFO memory | grep maxmemory_human

# If used > maxmemory:
redis-cli CONFIG SET maxmemory-policy allkeys-lru
# Or increase Redis maxmemory in redis.conf / provider settings
```

### F — Connection limit exhausted

```bash
redis-cli INFO clients | grep connected_clients
redis-cli INFO clients | grep maxclients

# The API uses ioredis with maxRetriesPerRequest: 3 and connectTimeout: 10000ms
# Restart the API to release pooled connections
```

---

## Recovery verification

```bash
# 1. Readiness probe
curl -s https://<host>/api/v1/ready | jq '.status, .checks.redis'
# Expected: "ok"  { "status": "ok", "latencyMs": <n> }

# 2. Auth smoke test — token refresh
curl -s -X POST https://<host>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<password>"}' -c /tmp/cookies.txt | jq .

curl -s -X POST https://<host>/api/v1/auth/refresh \
  -b /tmp/cookies.txt | jq .data.accessToken
# Should return a valid JWT string
```

---

## Escalation

| When | Escalate to |
|------|-------------|
| Redis cannot be restarted | Infrastructure / Cloud Provider Support |
| Outage > 15 minutes in production | Incident Commander — consider emergency auth bypass if clinicians are locked out |
| Redis data loss suspected | Data loss is acceptable (refresh tokens are short-lived JWTs); advise users to log in again |

---

## Related runbooks

- [Database Unavailable](./database-down.md)
- [Deployment Failure](./deployment-failure.md)
