# Runbook: Bootstrap First Admin

**Version:** 1.0  
**Audience:** Operator / DevOps  
**Applies to:** Production, Staging

---

## Purpose

Creates the first clinic, `owner_admin` user, and home-clinic assignment in a
freshly migrated database. This is a **one-time, separate CLI process**. It is
not part of application startup and must not be re-run once users exist.

The bootstrap is intentionally separate from demo seeding (`seed.ts`), which is
disabled in production.  No demo data, hardcoded passwords, or test accounts are
created.

---

## Safety controls

| Control | Behaviour |
|---------|-----------|
| **Existing-user guard** | Inside owner-admin RLS context, the script aborts if any user exists. |
| **Single transaction** | Clinic, user, and `user_clinic_assignments` INSERTs are one transaction; any failure rolls back all three. |
| **Password never logged** | The plaintext password and bcrypt hash are not written to any log line. |
| **bcrypt cost 12** | Password stored with `bcrypt.hash(password, 12)` — same cost as change-password flow. |
| **RLS bypass scoped** | Uses `owner_admin` RLS context (nil UUID) — identical to migration seed tooling; no policies are weakened. |
| **MFA not pre-enrolled** | Account is created with `mfa_enabled = false`; MFA enrollment is required on first login. |
| **No HTTP endpoint** | Only callable via CLI — no unauthenticated registration endpoint is exposed. |

---

## Prerequisites

1. Migrations have been applied using the standalone procedure in
   [Backend migration documentation](../../Backend/migrations/README.md), and a
   repeat run has exited successfully with zero pending migrations.
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

3. Dependencies, including `tsx`, are installed from the lockfile.
4. You have the credentials you want to set for the first admin.

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
The implementation accepts 12–128 characters and hashes the password with
bcrypt cost 12. MFA enrollment is mandatory for `owner_admin`.

---

## Steps

### 1 — Verify the target and RLS context

Confirm that the CLI has the intended `DATABASE_URL` without printing it.
Verification queries must use the application database role and an approved
owner-admin RLS transaction context. A raw count without context can be filtered
by forced RLS and must not be treated as proof that the database is empty.

If an RLS-aware count finds any user, do not proceed. The implementation repeats
this check inside the bootstrap transaction and refuses to run when users exist.

### 2 — Set environment variables

Supply the four bootstrap variables to the separate CLI process through an
approved one-off job secret configuration or the operator's current process
environment. Do not place them in source control, persist them in the normal
application service, echo them, or include their values in logs. Confirm
variable presence without displaying values.

### 3 — Run the bootstrap command

```powershell
# Run from the repository root.
npm.cmd run bootstrap:admin --workspace=@verve/backend
```

The script name is defined as `bootstrap:admin` in `Backend/package.json`.
Require process exit code `0`; logs alone are insufficient. Expected output
includes:

```
{"level":"info","clinicId":"<uuid>","clinicName":"Verve Dental","timezone":"Australia/Melbourne","msg":"Bootstrap: clinic created"}
{"level":"info","userId":"<uuid>","email":"owner@yourpractice.com.au","role":"owner_admin","clinicId":"<uuid>","clinicName":"Verve Dental","mfaEnabled":false,"msg":"Bootstrap: owner_admin created. MFA enrollment is required on first login."}
{"level":"info","msg":"Bootstrap complete. Login with the configured credentials and enroll MFA immediately."}
```

### 4 — Validate the atomic result and RLS

Using the application role and approved RLS contexts, verify:

- Exactly the intended clinic and active `owner_admin` exist.
- The user has the intended `home_clinic_id`.
- A matching `user_clinic_assignments` row exists with `can_roster=true` and
  `can_operate=true`.
- Owner-admin context can see the records.
- Ordinary clinic context cannot read data belonging to another clinic.
- A controlled repeat attempt is refused because a user now exists.

If the command fails, verify that none of the clinic, user, or assignment rows
persisted. Any partial result is a release blocker.

### 5 — Log in and enroll MFA immediately

1. Navigate to the login page.
2. Log in with the email and password set above.
3. The application will prompt for **MFA enrollment** before issuing an access token.
4. Complete setup and confirmation through `POST /api/v1/auth/mfa/setup` and
   `POST /api/v1/auth/mfa/confirm`.
5. Log in again and complete `POST /api/v1/auth/mfa/verify`.
6. Confirm authenticated API access.
7. Confirm refresh rotates the refresh cookie and keeps the session active.
8. Reload the browser and confirm the authenticated session is restored.
9. Log out, confirm the cookie is cleared, reload, and confirm the session is
   no longer authenticated.

**Do not leave MFA unenrolled.**  `owner_admin` and `group_practice_manager` accounts
require MFA before session tokens are issued.

### 6 — Unset credentials from the shell

After the script completes, remove the variables from the one-off job or current
PowerShell process. Never print their values.

```powershell
Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL,Env:BOOTSTRAP_ADMIN_PASSWORD,Env:BOOTSTRAP_CLINIC_NAME,Env:BOOTSTRAP_CLINIC_TIMEZONE -ErrorAction SilentlyContinue

'BOOTSTRAP_ADMIN_EMAIL','BOOTSTRAP_ADMIN_PASSWORD','BOOTSTRAP_CLINIC_NAME','BOOTSTRAP_CLINIC_TIMEZONE' |
  ForEach-Object {
    [pscustomobject]@{ Name = $_; Present = Test-Path "Env:$_" }
  }
```

Every entry must report `Present=False`. If variables were supplied through a
hosting dashboard or one-off job definition, remove the variable names there
and verify absence without displaying values. Do not leave bootstrap credentials
on the normal API service.

---

## Startup empty-users warning

The deployed startup path counts users inside the same transaction-local
owner-admin RLS context used by bootstrap verification. A zero count is
therefore an all-user count, not an unscoped RLS-filtered result. Treat an
unexpected empty-users warning as a provisioning stop condition.

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
