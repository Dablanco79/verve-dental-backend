import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

import type { AuthenticatedUser } from "../types/auth.js";
import { AppError } from "../types/errors.js";
import type { DatabasePool } from "./pool.js";

/**
 * Sentinel clinic UUID used by auth-layer queries (login, refresh, changePassword).
 *
 * Auth operations are cross-clinic by nature (email is globally unique across
 * tenants).  The user repository wraps these queries with withTenantContext
 * using ownerAdmin=true, which means app_is_owner_admin() evaluates to TRUE
 * and the clinic ID itself is ignored by all RLS policies.
 *
 * Using the nil UUID (all-zeros) makes the intent immediately visible in DB
 * audit logs and distinguishes auth queries from normal tenant queries.
 */
export const AUTH_BYPASS_CLINIC_ID = "00000000-0000-0000-0000-000000000000";

// ─────────────────────────────────────────────────────────────────────────────
// Tenant resolution helpers (application layer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the clinic scope for application-layer queries.
 *
 * `user.homeClinicId`  — the user's payroll/contract location (on every JWT).
 * `requestedClinicId`  — the clinic whose data is being accessed (from the URL).
 *
 * owner_admin may access any clinic; all other roles are restricted to their
 * homeClinicId.  When Roster support arrives, replace the simple homeClinicId
 * check with a roster-membership lookup so rostered staff can access the clinic
 * they are working at on a given shift.
 */
export function resolveTenantClinicId(
  user: AuthenticatedUser,
  requestedClinicId?: string,
): string {
  if (user.role === "owner_admin") {
    return requestedClinicId ?? user.homeClinicId;
  }

  if (requestedClinicId && requestedClinicId !== user.homeClinicId) {
    throw new AppError(
      403,
      "TENANT_ACCESS_DENIED",
      "You do not have access to this clinic's data",
    );
  }

  return user.homeClinicId;
}

/**
 * SQL session variable used with PostgreSQL RLS policies (migration 015).
 * Call before tenant-scoped queries: SET LOCAL app.current_clinic_id = '<uuid>'
 * Must be called inside a transaction (SET LOCAL is transaction-scoped).
 */
export const TENANT_SESSION_VAR = "app.current_clinic_id";

// ─────────────────────────────────────────────────────────────────────────────
// withTenantContext — transaction-local RLS enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes `fn` inside a transaction with the RLS session variables set.
 *
 * Within the transaction:
 *   SET LOCAL app.current_clinic_id = <clinicId>   → restricts row access
 *   SET LOCAL app.owner_admin_mode  = 'true'|'false'
 *
 * The SET LOCAL values are automatically reverted when the transaction
 * commits or rolls back — no connection-pool leakage risk.
 *
 * Usage:
 *   const rows = await withTenantContext(pool, clinicId, async (client) => {
 *     return client.query('SELECT * FROM invoices');
 *   });
 *   // rows contains only invoices belonging to clinicId (RLS enforced).
 *
 * @param pool          pg.Pool instance (from createDatabasePool).
 * @param clinicId      UUID of the target clinic.
 * @param fn            Callback receiving the tenant-scoped PoolClient.
 * @param ownerAdmin    Pass true for owner_admin cross-clinic operations.
 */
export async function withTenantContext<T>(
  pool: DatabasePool,
  clinicId: string,
  fn: (client: import("pg").PoolClient) => Promise<T>,
  ownerAdmin = false,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT
         set_config('app.current_clinic_id', $1, true),
         set_config('app.owner_admin_mode',  $2, true)`,
      [clinicId, ownerAdmin ? "true" : "false"],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AsyncLocalStorage — per-request RLS context propagation
// ─────────────────────────────────────────────────────────────────────────────

type TenantCtx = {
  clinicId: string;
  ownerAdmin: boolean;
};

/**
 * Per-request async storage.  Populated by rlsTenantContextMiddleware and
 * consumed by applyRlsContext() which is called from installRlsPoolHook().
 */
const tenantStorage = new AsyncLocalStorage<TenantCtx>();

/**
 * Returns the RLS context established for the current async call-chain
 * (i.e. the currently executing HTTP request), or null if none has been set.
 */
export function getCurrentTenantCtx(): TenantCtx | null {
  return tenantStorage.getStore() ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool hook — transparent context injection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Installs a connection-lifecycle hook on `pool` that transparently injects
 * the RLS session variables (app.current_clinic_id, app.owner_admin_mode)
 * onto every client checked out while an async request context is active.
 *
 * Implementation strategy
 * ───────────────────────
 * We override pool.connect() to intercept client checkout.  When there is an
 * active TenantCtx in AsyncLocalStorage:
 *
 *   1. set_config(key, value, false) sets a session-level variable.
 *      Combined with the release-time reset, this prevents context leakage
 *      without requiring an explicit transaction per query.
 *
 *   2. The original client.release() is wrapped to RESET both session vars to
 *      '' before returning the connection to the pool.
 *
 * FAIL-CLOSED BEHAVIOUR
 * ─────────────────────
 * If context injection fails, the client is DESTROYED (via release(error))
 * and the error is re-thrown.  We never continue with a connection that may
 * carry stale or missing RLS context — that would be a silent security bypass.
 *
 * If the context reset on release fails, the connection is also DESTROYED
 * rather than returned to the pool in an unknown state.
 *
 * NOTE: This hook affects ALL pool.query() calls because pg.Pool.query()
 * internally calls pool.connect() → client.query() → client.release().
 * Existing repositories require NO code changes.
 *
 * Call once at application startup (in createAppDependencies) after the pool
 * is created and confirmed reachable.
 */
export function installRlsPoolHook(pool: DatabasePool): void {
  const originalConnect = pool.connect.bind(pool);

  // Cast required because pg.Pool.connect() overloads don't expose a simple
  // override surface; we return the same PoolClient type.
  (pool as unknown as { connect: () => Promise<import("pg").PoolClient> }).connect =
    async (): Promise<import("pg").PoolClient> => {
      const client = await originalConnect();
      const ctx = tenantStorage.getStore();

      if (ctx) {
        try {
          await client.query(
            `SELECT
               set_config('app.current_clinic_id', $1, false),
               set_config('app.owner_admin_mode',  $2, false)`,
            [ctx.clinicId, ctx.ownerAdmin ? "true" : "false"],
          );
        } catch (injectionErr) {
          // Fail-closed: destroy this connection rather than returning it with
          // unknown RLS state.  The caller receives the error and the request
          // fails with 500 — never with a dirty or no-context connection.
          client.release(
            injectionErr instanceof Error
              ? injectionErr
              : new Error(String(injectionErr)),
          );
          throw new Error(
            `RLS context injection failed — connection destroyed: ${String(injectionErr)}`,
          );
        }

        // Wrap release to reset the session variables before the connection
        // is returned to the pool, preventing context leakage to the next request.
        const originalRelease = client.release.bind(client);
        (client as unknown as { release: () => void }).release = () => {
          void client
            .query(
              `SELECT
                 set_config('app.current_clinic_id', '', false),
                 set_config('app.owner_admin_mode',  '', false)`,
            )
            .then(() => { originalRelease(); })
            .catch((resetErr: unknown) => {
              // Fail-closed on reset: destroy the connection rather than
              // returning it to the pool with stale RLS context.
              originalRelease(
                resetErr instanceof Error
                  ? resetErr
                  : new Error(String(resetErr)),
              );
            });
        };
      }

      return client;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Express middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Express middleware that establishes the per-request RLS tenant context.
 *
 * Must be placed AFTER the authenticate middleware (requires req.user) and
 * BEFORE any route handler that performs database queries.
 *
 * CONTEXT BINDING RULES
 * ─────────────────────
 * owner_admin: clinicId = req.params.clinicId ?? req.user.homeClinicId
 *   owner_admin may legitimately access any clinic; the URL clinicId drives
 *   which clinic's data the current request is scoped to.
 *
 * all other roles: clinicId = req.user.homeClinicId (ALWAYS from JWT)
 *   Non-admin users are ALWAYS scoped to the clinic in their JWT, regardless
 *   of the URL parameter.  This means even if enforceTenantParam has a bug,
 *   the RLS context will never be set to a clinic other than the user's own.
 *   The application-layer guard (enforceTenantParam) still runs independently
 *   — this is defence-in-depth.
 *
 * The AsyncLocalStorage context propagates automatically through all
 * async/await chains spawned within the request handler.
 */
export function rlsTenantContextMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next();
      return;
    }

    const params = req.params as Record<string, string | undefined>;
    const isOwnerAdmin = req.user.role === "owner_admin";

    // For non-owner users the RLS context is always derived from the JWT
    // homeClinicId — never from the raw URL parameter.  This prevents a
    // URL-manipulation attack from escalating the DB-layer context even if
    // the application-layer check has a gap.
    const clinicId = isOwnerAdmin
      ? (params["clinicId"] ?? req.user.homeClinicId)
      : req.user.homeClinicId;

    if (!clinicId) {
      next();
      return;
    }

    const ctx: TenantCtx = {
      clinicId,
      ownerAdmin: isOwnerAdmin,
    };

    tenantStorage.run(ctx, next);
  };
}
