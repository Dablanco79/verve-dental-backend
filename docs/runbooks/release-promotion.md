# Runbook: Staging-to-Production Release Promotion

**Snapshot date:** 2026-10-13
**Status:** Procedure documented; Production readiness not yet proven

This is the central release sequence. Detailed migration, bootstrap, failure,
and recovery procedures are linked rather than repeated here.

## Current infrastructure snapshot

As verified on the snapshot date:

- Staging contains the API, frontend, PostgreSQL 18, and an existing cache. The
  hosted cache version is unverified. Integration CI uses Valkey 8, but that is
  not evidence of the hosted cache version.
- Staging `NODE_ENV=production` remains unchanged pending deliberate review.
- Production contains only a fresh PostgreSQL database.
- Production cache, API, and frontend creation is deferred.
- Production auto-deploy must be **OFF**.

These are dated observations, not permanent guarantees. Reconfirm the actual
hosted state before every release.

## Release gates

Do not promote while any applicable gate is unresolved:

- The exact commit has passed the required GitHub checks:
  `Monorepo — lint, typecheck, test` and
  `Backend — PostgreSQL + Redis integration`.
- Staging has tested the immutable full commit SHA.
- Pending migrations and old/new application schema compatibility were reviewed.
- Backup availability and restoration capability were verified rather than
  assumed; see [Backup & Restore](./backup-restore.md).
- TLS and deployed configuration were reviewed.
- Live first-admin bootstrap and RLS behavior were validated where applicable.
- Dependency vulnerabilities were assessed and accepted or remediated.
- Workforce pilot acceptance blockers were resolved in the separate Workforce
  workstream.
- Branding and controlled catalogue import were accepted.

## Staging acceptance

1. Record the full 40-character candidate SHA. Do not use a branch name,
   `latest`, or a moving tag as the release identity.
2. Confirm the required GitHub checks succeeded for that SHA.
3. Confirm Staging deploy details show that full SHA for every applicable
   source-deployed service.
4. Preserve Staging data. Do not run test setup or demo seeds.
5. If the SHA has migrations, run the standalone procedure in
   [Backend migrations](../../Backend/migrations/README.md). Keep
   `MIGRATE_ON_STARTUP=false`.
6. Complete Staging release acceptance:
   - liveness and readiness;
   - fresh login and mandatory MFA where applicable;
   - refresh-token rotation;
   - browser-reload session persistence;
   - logout and post-logout reload;
   - critical clinic workflows and tenant isolation.
7. Record the successfully tested full SHA and acceptance evidence.

Do not begin Production preparation until the Staging acceptance result and
immutable full SHA have been recorded.

## Production preparation

Complete these steps before deploying any Production application service:

1. Confirm the intended isolated Production database and Production
   configuration. Verify variable presence and target identity without printing
   secrets or connection strings.
2. Review pending migrations, old/new application schema compatibility, and the
   recovery prerequisites in [Backup & Restore](./backup-restore.md).
3. From the exact full SHA accepted in Staging, run the standalone Production
   migration procedure in
   [Backend migrations](../../Backend/migrations/README.md). Keep
   `MIGRATE_ON_STARTUP=false`.
4. Require the first migration process to exit successfully. Run it again
   against the same Production database, require another successful exit, and
   confirm zero pending migrations. Logs without successful process exits are
   insufficient.
5. For **initial provisioning only**, run
   [Bootstrap First Admin](./bootstrap-admin.md), validate the atomic clinic,
   user, and home-clinic assignment through the required RLS contexts, and
   remove and verify removal of all temporary bootstrap variables. Never run
   bootstrap during a routine subsequent release; its existing-user guard
   should refuse such an attempt.
6. Review Production-specific configuration, including database TLS, cache/TLS,
   separate Production secrets, exact HTTPS CORS origins, deployed cookie
   behavior, reset/feature flags, service URLs, and
   `MIGRATE_ON_STARTUP=false`. Do not copy Staging credentials or connection
   settings.
7. Confirm Production auto-deploy is **OFF** for each source-deployed service.

If any preparation step fails or produces unexpected state, stop before
deploying application services.

## Production application deployment and acceptance

1. Manually select and deploy the same full SHA accepted in Staging to each
   applicable Production service. Never choose “deploy latest commit.”
2. Require a successful provider deploy status and verify the source SHA in
   each service's deploy details. The repository does not currently expose a
   runtime build-SHA endpoint, so provider deploy metadata is required.
3. Keep initial Production access restricted to the authorised acceptance team.
4. Complete Production acceptance:
   - liveness and readiness;
   - mandatory MFA enrollment or challenge as applicable;
   - fresh login, refresh-token rotation, browser-reload persistence, logout,
     and post-logout reload;
   - RLS and cross-clinic tenant-isolation validation;
   - critical clinic workflows and all applicable rollout gates.
5. Do not expand access beyond acceptance testing until every applicable check
   passes and an authorised release decision is recorded.

PostgreSQL is not a source-deployed service and has no application SHA. Record
its applied migration IDs separately. At the current snapshot, no Production
API, cache, or frontend exists, so steps for those services cannot yet be
performed.

## Health is not release acceptance

`GET /api/v1/health` proves only that the process is alive.
`GET /api/v1/ready` probes PostgreSQL as critical and Redis as noncritical.
A successful or degraded readiness response does not prove that login, MFA,
refresh-token storage, browser cookies, logout, tenant isolation, or business
workflows work. Complete the acceptance sequence above.

## Failure and rollback

Stop promotion on an unexpected SHA, unsuccessful process exit, pending
migration, failed acceptance check, or unexplained data/configuration mismatch.
Follow [Deployment Failure](./deployment-failure.md).

Rolling application code back does not reverse database migrations. Before an
application rollback, verify that the older code is compatible with the current
schema and migrated data. Do not automatically execute down migrations and do
not force-push tags. If compatibility is not demonstrated, keep traffic off the
older version and use the approved database recovery plan.

## Hosted evidence to retain

- Full candidate and deployed SHA for each applicable service.
- Required CI check results.
- Migration command exit codes and migration IDs, without secrets.
- Staging and Production acceptance results.
- Backup/restore evidence and schema-compatibility decision.
- Operator, timestamps, exceptions, and rollback decision.
