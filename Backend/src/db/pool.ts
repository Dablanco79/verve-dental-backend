import pg from "pg";

import type { EnvConfig } from "../config/index.js";

export type DatabasePool = pg.Pool;

export type DatabasePoolErrorEvent = {
  category: "postgres_pool_idle_client_error";
  code: string;
};

export type DatabasePoolErrorReporter = (event: DatabasePoolErrorEvent) => void;

function poolErrorCode(error: Error): string {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN";
}

function parseDatabaseSslMode(
  databaseUrl: string,
): "disable" | "require" | "verify-ca" | "verify-full" | null {
  try {
    const url = new URL(databaseUrl);
    const sslmode = url.searchParams.get("sslmode")?.toLowerCase();

    if (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") {
      return "disable";
    }

    if (
      sslmode === "require" ||
      sslmode === "verify-ca" ||
      sslmode === "verify-full"
    ) {
      return sslmode;
    }
  } catch {
    return null;
  }

  return null;
}

function isLocalDatabaseHost(databaseUrl: string): boolean {
  try {
    const hostname = new URL(databaseUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function isDeployedRemoteDatabase(config: EnvConfig): boolean {
  return (
    Boolean(config.DATABASE_URL) &&
    (config.NODE_ENV === "production" || config.NODE_ENV === "staging") &&
    !isLocalDatabaseHost(config.DATABASE_URL as string)
  );
}

/**
 * node-postgres parses SSL query parameters after the explicit Pool options,
 * allowing connection-string values to replace the resolved `ssl` object.
 * Deployed URLs retain sslmode for validation, but it is removed before Pool
 * construction so `{ rejectUnauthorized: true }` remains authoritative.
 */
export function databaseConnectionStringForPool(config: EnvConfig): string {
  if (!config.DATABASE_URL || !isDeployedRemoteDatabase(config)) {
    return config.DATABASE_URL as string;
  }

  const url = new URL(config.DATABASE_URL);
  const overridingParameters = [
    "ssl",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ].filter((parameter) => url.searchParams.has(parameter));

  if (overridingParameters.length > 0) {
    throw new Error(
      `Deployed remote PostgreSQL DATABASE_URL contains unsupported TLS parameter(s): ${overridingParameters.join(
        ", ",
      )}. Configure trust through the runtime certificate store instead.`,
    );
  }

  url.searchParams.delete("sslmode");
  return url.toString();
}

/**
 * Resolves PostgreSQL SSL settings. Deployed remote connections require
 * `sslmode=verify-full`; development and test retain deliberate local options.
 */
export function resolvePostgresSsl(
  config: EnvConfig,
): pg.ConnectionConfig["ssl"] | undefined {
  if (!config.DATABASE_URL) {
    return undefined;
  }

  const sslModeFromUrl = parseDatabaseSslMode(config.DATABASE_URL);
  const isLocalHost = isLocalDatabaseHost(config.DATABASE_URL);
  const isDeployedRemote = isDeployedRemoteDatabase(config);

  if (isDeployedRemote) {
    if (config.DATABASE_SSL === "false" || sslModeFromUrl === "disable") {
      throw new Error(
        "Deployed remote PostgreSQL connections cannot disable TLS certificate verification",
      );
    }
    if (sslModeFromUrl !== "verify-full") {
      throw new Error(
        "Deployed remote PostgreSQL DATABASE_URL must use sslmode=verify-full",
      );
    }
    return { rejectUnauthorized: true };
  }

  if (config.DATABASE_SSL === "false") {
    return undefined;
  }

  if (sslModeFromUrl === "disable") {
    return undefined;
  }

  const shouldUseSsl =
    config.DATABASE_SSL === "true" ||
    sslModeFromUrl === "require" ||
    sslModeFromUrl === "verify-ca" ||
    sslModeFromUrl === "verify-full" ||
    ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") &&
      !isLocalHost);

  if (!shouldUseSsl) {
    return undefined;
  }

  return {
    rejectUnauthorized:
      sslModeFromUrl === "verify-ca" || sslModeFromUrl === "verify-full",
  };
}

export function createDatabasePool(
  config: EnvConfig,
  reportError?: DatabasePoolErrorReporter,
): DatabasePool | null {
  if (!config.DATABASE_URL) {
    return null;
  }

  const ssl = resolvePostgresSsl(config);
  const connectionString = databaseConnectionStringForPool(config);

  const pool = new pg.Pool({
    connectionString,
    ssl,
    max: config.NODE_ENV === "production" ? 20 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // node-postgres emits `error` on the Pool when an idle client is terminated
  // unexpectedly. EventEmitter treats an unhandled `error` as fatal, so this
  // listener must be attached before the pool can execute its first query.
  // pg removes the failed idle client itself; retrying application operations
  // here could duplicate writes and is intentionally avoided.
  pool.on("error", (error) => {
    const event: DatabasePoolErrorEvent = {
      category: "postgres_pool_idle_client_error",
      code: poolErrorCode(error),
    };
    if (reportError) {
      try {
        reportError(event);
      } catch {
        // A reporting failure must not turn a handled idle-client error back
        // into an unhandled EventEmitter crash.
      }
    }
  });

  return pool;
}
