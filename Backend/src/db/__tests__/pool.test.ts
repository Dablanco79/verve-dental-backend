import { describe, expect, it } from "@jest/globals";

import type { EnvConfig } from "../../config/index.js";
import {
  createDatabasePool,
  databaseConnectionStringForPool,
  resolvePostgresSsl,
} from "../pool.js";
import { installRlsPoolHook } from "../tenantContext.js";

function config(
  databaseUrl: string,
  nodeEnv: EnvConfig["NODE_ENV"],
  databaseSsl: EnvConfig["DATABASE_SSL"] = "auto",
): EnvConfig {
  return {
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: databaseSsl,
    NODE_ENV: nodeEnv,
  } as EnvConfig;
}

describe("resolvePostgresSsl", () => {
  it("requires full certificate and hostname verification in production", () => {
    expect(
      resolvePostgresSsl(
        config(
          "postgresql://app:secret@db.example.test/app?sslmode=verify-full",
          "production",
        ),
      ),
    ).toEqual({ rejectUnauthorized: true });
  });

  it.each([
    "postgresql://app:secret@db.example.test/app",
    "postgresql://app:secret@db.example.test/app?sslmode=require",
    "postgresql://app:secret@db.example.test/app?sslmode=verify-ca",
    "postgresql://app:secret@db.example.test/app?sslmode=disable",
  ])("rejects an unverifiable deployed remote URL: %s", (databaseUrl) => {
    expect(() =>
      resolvePostgresSsl(config(databaseUrl, "production")),
    ).toThrow(/sslmode=verify-full|cannot disable/i);
  });

  it("rejects DATABASE_SSL=false for a deployed remote database", () => {
    expect(() =>
      resolvePostgresSsl(
        config(
          "postgresql://app:secret@db.example.test/app?sslmode=verify-full",
          "staging",
          "false",
        ),
      ),
    ).toThrow(/cannot disable/i);
  });

  it("preserves deliberate unencrypted localhost test configuration", () => {
    expect(
      resolvePostgresSsl(
        config(
          "postgresql://test:test@localhost:5432/verve_test?sslmode=disable",
          "test",
          "false",
        ),
      ),
    ).toBeUndefined();
  });

  it("preserves explicit require mode outside deployed environments", () => {
    expect(
      resolvePostgresSsl(
        config(
          "postgresql://test:test@integration-db/verve_test?sslmode=require",
          "test",
        ),
      ),
    ).toEqual({ rejectUnauthorized: false });
  });

  it("removes validated sslmode before node-postgres can replace the explicit TLS object", async () => {
    const deployedConfig = config(
      "postgresql://app:secret@db.example.test/app?application_name=renqor&sslmode=verify-full",
      "production",
    );

    expect(databaseConnectionStringForPool(deployedConfig)).toBe(
      "postgresql://app:secret@db.example.test/app?application_name=renqor",
    );

    const pool = createDatabasePool(deployedConfig);
    expect(pool).not.toBeNull();
    const options = (pool as unknown as {
      options: { connectionString: string; ssl: unknown };
    }).options;
    expect(options.connectionString).not.toMatch(/[?&]sslmode=/);
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    await pool?.end();
  });

  it.each(["sslrootcert", "sslcert", "sslkey", "ssl", "uselibpqcompat"])(
    "rejects deployed connection-string parameter %s before it can override resolved TLS",
    (parameter) => {
      const databaseUrl =
        "postgresql://app:secret@db.example.test/app" +
        `?sslmode=verify-full&${parameter}=synthetic`;
      expect(() =>
        createDatabasePool(config(databaseUrl, "production")),
      ).toThrow(/unsupported TLS parameter/i);
    },
  );

  it("does not rewrite deliberate local test connection strings", async () => {
    const localConfig = config(
      "postgresql://test:test@localhost:5432/verve_test?sslmode=disable",
      "test",
      "false",
    );
    expect(databaseConnectionStringForPool(localConfig)).toBe(
      localConfig.DATABASE_URL,
    );
    const pool = createDatabasePool(localConfig);
    await pool?.end();
  });

  it("handles an idle-client pool error without throwing or exposing error details", async () => {
    const events: unknown[] = [];
    const pool = createDatabasePool(
      config(
        "postgresql://test:secret@localhost:5432/verve_test?sslmode=disable",
        "test",
        "false",
      ),
      (event) => {
        events.push(event);
      },
    );
    expect(pool).not.toBeNull();
    if (!pool) return;

    // The RLS hook mutates connect() on this same pool instance. Its presence
    // must neither remove nor bypass the pool-level idle-client error guard.
    installRlsPoolHook(pool);
    const reset = Object.assign(
      new Error("connection string and credentials must never be reported"),
      { code: "ECONNRESET" },
    );

    expect(() => pool.emit("error", reset, undefined)).not.toThrow();
    expect(events).toEqual([
      {
        category: "postgres_pool_idle_client_error",
        code: "ECONNRESET",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(reset.message);

    await pool.end();
  });

  it("contains failures thrown by the pool error reporter", async () => {
    const pool = createDatabasePool(
      config(
        "postgresql://test:secret@localhost:5432/verve_test?sslmode=disable",
        "test",
        "false",
      ),
      () => {
        throw new Error("synthetic reporting failure");
      },
    );
    expect(pool).not.toBeNull();
    if (!pool) return;

    expect(() =>
      pool.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" }), undefined),
    ).not.toThrow();

    await pool.end();
  });
});
