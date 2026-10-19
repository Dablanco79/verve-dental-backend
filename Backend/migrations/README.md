# Backend Migrations

## How the migration system works

Verve uses an **inline bootstrap migration runner** defined in:

```
Backend/src/db/migrate.ts   →   BOOTSTRAP_MIGRATIONS array
```

`runBootstrapMigrations()` compares this array with `schema_migrations`.
Development/test setup and the standalone migration CLI may apply missing
entries. Staging and Production application startup is structurally check-only
and refuses pending or unknown IDs. Apply mode executes inside a single
transaction protected by a PostgreSQL advisory lock.

The runner is invoked by the normal application startup path in `src/bootstrap/dependencies.ts`.

---

## What the .sql files in this directory are

The files in `Backend/migrations/` are **reference and rollback documentation only**.

- They are **not read or executed** by the application, the startup path, or any automated process.
- They exist so that engineers can review exact DDL, understand schema history, and manually apply rollback SQL if required.
- A `*.up.sql` file describes the forward migration. A `*.down.sql` file describes the corresponding rollback.

**Do not assume that creating a file here will run it in production.** It will not.

---

## Adding a new production migration

1. Write and test your SQL in the appropriate `*.up.sql` / `*.down.sql` files in this directory.
2. Open `Backend/src/db/migrate.ts` and append a new entry to the end of `BOOTSTRAP_MIGRATIONS`:

```typescript
{
  id: "039_your_migration_name",   // next sequential number after the current highest
  sql: `
    -- your SQL here
    -- use IF NOT EXISTS / DO $$ guards for idempotency
  `,
}
```

3. Choose the `id` only after checking active workstreams as well as the
   current branch. Never reuse a number already assigned on a branch awaiting
   integration. Migration `058_leave_coverage_groups` belongs to the Workforce
   workstream, so this branch uses `059_force_workflow_table_rls`.
4. Write or update tests in `Backend/tests/migrationGate.test.ts` to confirm the new entry is registered.
5. Run the full validation suite before opening a pull request:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

---

## Current migration sequence

`Backend/src/db/migrate.ts` is the source of truth for the current ordered
sequence. Do not copy a fixed migration count or final ID into an operational
check: both become stale when a migration is added.

Existing migration SQL is append-only. `Backend/tests/migrationImmutability.test.ts`
records reviewed source hashes and fails if an existing body is edited. That
source-level control does not prove live-schema equivalence and does not replace
catalog checks, behavioral tests, or restore drills.

---

## Deployed-environment procedure

Keep `MIGRATE_ON_STARTUP=false` in Staging and Production. Normal application
startup calls the runner in gate mode: it checks the schema and refuses to start
if migrations are pending, but it does not apply them.

Migrations are applied by a separate, deliberate CLI process from the exact
release source:

```powershell
# Run from the repository root.
npm.cmd run migrate --workspace=@verve/backend
```

The equivalent command from `Backend` is `npm.cmd run migrate`.

### Prerequisites

- Node.js 20 or newer.
- A lockfile-based workspace install that includes development dependencies
  (`tsx` executes `Backend/src/db/runMigrate.ts`). A compiled backend build is
  not required for this command, although the release build must be validated
  separately.
- `DATABASE_URL` for the intended database and the correct `DATABASE_SSL`
  policy.
- Configuration accepted by `Backend/src/config/index.ts`, including
  `NODE_ENV`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `MFA_ENCRYPTION_KEY`, and, in a deployed environment, an explicit HTTPS
  `CORS_ORIGIN`.
- `MIGRATE_ON_STARTUP=false`. The standalone CLI explicitly opts into applying
  migrations; changing the application startup setting is unnecessary.

Supply configuration to this one-off CLI process through the approved secret
store or operator environment. Do not print connection strings or secrets.

### Execution and verification

1. Record the immutable full release SHA and review every pending migration.
2. Confirm the backup and restore prerequisites in
   `docs/runbooks/backup-restore.md`.
3. Run the standalone command once.
4. Require process exit code `0`. Logs alone are not proof of success.
5. Run the same command a second time against the same database.
6. Require exit code `0` again and confirm the output includes
   `Migration check: 0 pending` and
   `No pending migrations — schema is up to date`.

On the first run, expected progress includes `Migration applied: <id>` for each
pending migration and `All N migration(s) applied successfully`. The CLI then
logs `All migrations applied successfully`.

Any non-zero exit, missing final success, unexpected pending ID, or database
error is a stop condition. Do not start or promote the application until the
failure has been investigated and a repeat execution confirms zero pending
migrations.

> **Hosted-data safety:** Never run
> `npm.cmd run test:db:setup --workspace=@verve/backend` against Staging or
> Production. It is test setup and seeds demo data.

### Rollback

Application rollback does not remove migrations already recorded in
`schema_migrations`. Reference `.down.sql` files are never automatic and must
not be treated as a routine rollback mechanism. Before reverting application
code, review whether the older application is compatible with the current
schema and data. If it is not, stop and use an approved, tested database
recovery plan.

See `docs/runbooks/release-promotion.md` for the end-to-end release sequence.
