import pg from "pg";

import type { EnvConfig } from "../config/index.js";

export type DatabasePool = pg.Pool;

function parseDatabaseSslMode(
  databaseUrl: string,
): "disable" | "require" | "verify" | null {
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
      return sslmode === "verify-full" || sslmode === "verify-ca"
        ? "verify"
        : "require";
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

/**
 * Resolves PostgreSQL SSL settings for cloud hosts (Render, Railway, AWS RDS, etc.).
 * `DATABASE_SSL=auto` (default) enables SSL for remote hosts and when `sslmode=require` is present.
 */
export function resolvePostgresSsl(
  config: EnvConfig,
): pg.ConnectionConfig["ssl"] | undefined {
  if (!config.DATABASE_URL) {
    return undefined;
  }

  if (config.DATABASE_SSL === "false") {
    return undefined;
  }

  const sslModeFromUrl = parseDatabaseSslMode(config.DATABASE_URL);

  if (sslModeFromUrl === "disable") {
    return undefined;
  }

  const shouldUseSsl =
    config.DATABASE_SSL === "true" ||
    sslModeFromUrl === "require" ||
    sslModeFromUrl === "verify" ||
    ((config.NODE_ENV === "production" || config.NODE_ENV === "staging") &&
      !isLocalDatabaseHost(config.DATABASE_URL));

  if (!shouldUseSsl) {
    return undefined;
  }

  return {
    rejectUnauthorized: sslModeFromUrl === "verify",
  };
}

export function createDatabasePool(config: EnvConfig): DatabasePool | null {
  if (!config.DATABASE_URL) {
    return null;
  }

  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: resolvePostgresSsl(config),
    max: config.NODE_ENV === "production" ? 20 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
