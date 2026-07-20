# Backend Migrations

## How the migration system works

Verve uses an **inline bootstrap migration runner** defined in:

```
Backend/src/db/migrate.ts   →   BOOTSTRAP_MIGRATIONS array
```

At startup, `runBootstrapMigrations()` iterates this array and applies any entry whose `id` is not yet recorded in the `schema_migrations` table. Each entry contains the full SQL inline. Migrations execute inside a single transaction protected by a PostgreSQL advisory lock, so concurrent Render instances cannot race each other.

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

3. Choose the `id` using the **next available bootstrap migration number**, not the SQL filename number (the two numbering sequences are independent).
4. Write or update tests in `Backend/tests/migrationGate.test.ts` to confirm the new entry is registered.
5. Run the full validation suite before opening a pull request:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

---

## Current migration sequence

| Bootstrap ID | Description |
|---|---|
| 003–005a | Users, inventory foundation |
| 006–011 | Roster, payroll, leave |
| 012–015 | Clinics, billing, analytics, RLS |
| 016–020 | TOTP, user permissions |
| 021–033 | Supplier OCR, organisations, procurement |
| 034–036 | Master products, product matching |
| 037 | `037_stocktake_schema` — stocktake sessions and lines |
| 038 | `038_stocktake_line_snapshot` — product snapshot columns |

---

## MIGRATE_ON_STARTUP

This environment variable controls whether pending migrations are applied at startup in staging and production.

| Value | Behaviour |
|---|---|
| `false` (default) | Startup proceeds without running migrations. If pending migrations exist, startup is **blocked** with a clear error message. |
| `true` | Pending migrations are applied before the application accepts traffic. |

### Normal operation

`MIGRATE_ON_STARTUP` must remain `false` in production at all times **except during a controlled migration deployment**.

### Deploying a schema migration to production

1. Deploy the updated backend code (containing the new `BOOTSTRAP_MIGRATIONS` entry).
2. Set `MIGRATE_ON_STARTUP=true` in the Render environment.
3. Trigger a manual redeploy.
4. Confirm in Render logs that each migration ID appears with `"Migration applied: <id>"`.
5. Set `MIGRATE_ON_STARTUP=false` and redeploy again to return to normal startup mode.

### Down migrations

Down SQL files are **never executed automatically**. If a rollback is required, apply the `.down.sql` file manually against the database under controlled conditions, then remove the corresponding entry from `BOOTSTRAP_MIGRATIONS` and redeploy.
