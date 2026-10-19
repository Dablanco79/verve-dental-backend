import { createDatabasePool } from "../../src/db/pool.js";
import type { EnvConfig } from "../../src/config/index.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  process.stderr.write("TLS_PROBE_CONFIG_MISSING\n");
  process.exitCode = 2;
} else {
  const config = {
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: "auto",
    NODE_ENV: "production",
  } as EnvConfig;

  const pool = createDatabasePool(config);
  if (!pool) {
    process.stderr.write("TLS_PROBE_POOL_MISSING\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await pool.query<{ ssl: boolean }>(
        `SELECT ssl
           FROM pg_stat_ssl
          WHERE pid = pg_backend_pid()`,
      );
      if (result.rows[0]?.ssl !== true) {
        process.stderr.write("TLS_PROBE_CONNECTION_NOT_ENCRYPTED\n");
        process.exitCode = 1;
      } else {
        process.stdout.write("TLS_PROBE_OK\n");
      }
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "TLS_CONNECTION_FAILED";
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
}
