# Runbook: Bootstrap First Admin

**Version:** 1.0  
**Audience:** Operator / DevOps  
**Applies to:** Production, Staging

---

## Purpose

Creates the first clinic and `owner_admin` user in a freshly-deployed production
database.  This is a **one-time operator action** — it is not part of normal
application startup and should not be re-run once users exist.

The bootstrap is intentionally separate from demo seeding (`seed.ts`), which is
disabled in production.  No demo data, hardcoded passwords, or test accounts are
created.

---

## Safety controls

| Control | Behaviour |
|---------|-----------|
| **Idempotency guard** | Script aborts immediately if `COUNT(*) > 0` on the `users` table. |
| **Single transaction** | Clinic and user INSERTs are wrapped in one transaction; a failure rolls both back. |
| **Password never logged** | The plaintext password and bcrypt hash are not written to any log line. |
| **bcrypt cost 12** | Password stored with `bcrypt.hash(password, 12)` — same cost as change-password flow. |
| **RLS bypass scoped** | Uses `owner_admin` RLS context (nil UUID) — identical to migration seed tooling; no policies are weakened. |
| **MFA not pre-enrolled** | Account is created with `mfa_enabled = false`; MFA enrollment is required on first login. |
| **No HTTP endpoint** | Only callable via CLI — no unauthenticated registration endpoint is exposed. |

---

## Prerequisites

1. Migrations have been applied (`npm run migrate`).
2. The server's standard `.env` file (or environment) is present with all required
   variables:

   ```
   DATABASE_URL=postgres://...
   JWT_ACCESS_SECRET=...       (min 32 chars)
   JWT_REFRESH_SECRET=...      (min 32 chars)
   MFA_ENCRYPTION_KEY=...      (min 64 hex chars)
   CORS_ORIGIN=https://...
   NODE_ENV=production
   ```

3. You have the credentials you want to set for the first admin.

---

## Environment variables

Set these **in addition to** the standard server env vars before running the
script.  Do **not** commit them to source control or .env files.

| Variable | Required | Description |
|----------|----------|-------------|
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | Email address for the first `owner_admin` account |
| `BOOTSTRAP_ADMIN_PASSWORD` | Yes | Plaintext password (hashed before storage) |
| `BOOTSTRAP_CLINIC_NAME` | Yes | Display name for the first clinic |
| `BOOTSTRAP_CLINIC_TIMEZONE` | No | IANA timezone string (default: `Australia/Melbourne`) |

**Password requirements:** Use a strong, unique password of at least 12 characters.
Change it after first login if desired.  MFA enrollment is required on first login
regardless.

---

## Steps

### 1 — Verify database is empty

Connect to the production database and confirm the `users` table is empty:

```sql
SELECT COUNT(*) FROM users;
-- Expected: 0
```

If the count is non-zero, do not proceed.  Use the admin interface instead.

### 2 — Set environment variables

Export the bootstrap variables in your shell session (never write them to a file
that could be committed or leaked):

```sh
export BOOTSTRAP_ADMIN_EMAIL="owner@yourpractice.com.au"
export BOOTSTRAP_ADMIN_PASSWORD="<choose a strong password>"
export BOOTSTRAP_CLINIC_NAME="Verve Dental"
export BOOTSTRAP_CLINIC_TIMEZONE="Australia/Melbourne"
```

### 3 — Run the bootstrap command

```sh
cd Backend
npm run bootstrap:admin
```

Expected output (fields will contain real UUIDs):

```
{"level":"info","clinicId":"<uuid>","clinicName":"Verve Dental","timezone":"Australia/Melbourne","msg":"Bootstrap: clinic created"}
{"level":"info","userId":"<uuid>","email":"owner@yourpractice.com.au","role":"owner_admin","clinicId":"<uuid>","clinicName":"Verve Dental","mfaEnabled":false,"msg":"Bootstrap: owner_admin created. MFA enrollment is required on first login."}
{"level":"info","msg":"Bootstrap complete. Login with the configured credentials and enroll MFA immediately."}
```

### 4 — Verify the account was created

```sql
SELECT id, email, role, home_clinic_id, mfa_enabled, is_active
FROM users
WHERE role = 'owner_admin';
```

Also confirm the clinic row:

```sql
SELECT id, name, timezone, subscription_tier FROM clinics;
```

### 5 — Log in and enroll MFA immediately

1. Navigate to the login page.
2. Log in with the email and password set above.
3. The application will prompt for **MFA enrollment** before issuing an access token.
4. Complete TOTP enrollment with an authenticator app (e.g. Authy, Google Authenticator).
5. Store the recovery codes securely.

**Do not leave MFA unenrolled.**  `owner_admin` and `group_practice_manager` accounts
require MFA before session tokens are issued.

### 6 — Unset credentials from the shell

After the script completes, clear the bootstrap variables from your shell:

```sh
unset BOOTSTRAP_ADMIN_EMAIL
unset BOOTSTRAP_ADMIN_PASSWORD
unset BOOTSTRAP_CLINIC_NAME
unset BOOTSTRAP_CLINIC_TIMEZONE
```

---

## Error reference

| Error message | Cause | Resolution |
|---------------|-------|------------|
| `Bootstrap refused: N user(s) already exist` | Users table is not empty | Do not re-run; manage accounts via admin interface |
| `Bootstrap failed: missing required environment variable(s): ...` | One or more env vars not set | Set the listed variables and retry |
| `DATABASE_URL is required to run bootstrap` | `DATABASE_URL` missing from env | Add it to `.env` or export it |
| `Invalid environment configuration: ...` | Standard server env vars invalid | Fix the listed config fields |
| `Bootstrap failed` (generic) | Database error during INSERT | Check DB connectivity and migration state; retry from step 1 |

---

## After bootstrap

Once the first `owner_admin` is created and MFA-enrolled, all further user and
clinic management is performed through the application UI:

- **Add staff** — Admin UI → Users → Invite
- **Add additional clinics** — Admin UI → Clinics → New Clinic
- **Reset passwords** — Admin UI → Users → Reset Password

The bootstrap script will refuse to run again as long as any user exists.

---

## Audit trail

Every bootstrap attempt is logged at the application level.  On success, log lines
include `clinicId`, `userId`, and `email` — but never the password or its hash.
Failed attempts (guard fires, DB error, missing env vars) are also logged with
the reason.

For a full audit, inspect the `audit_events` table after login actions complete.
