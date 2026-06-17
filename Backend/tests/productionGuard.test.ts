/**
 * Production startup guard tests
 *
 * Verifies that createAppDependencies() fails fast with a clear error message
 * when required infrastructure environment variables are missing in production,
 * rather than silently falling back to in-memory state.
 *
 * Also covers:
 *   • Staging fail-closed (DATABASE_URL / REDIS_URL required)
 *   • CORS wildcard rejection for staging and production
 *
 * All tests are network-free: the guards fire before any pool/client is
 * connected, so no real database or Redis instance is required.
 */

import { createAppDependencies } from "../src/bootstrap/dependencies.js";
import { assertDeployedCorsOrigin } from "../src/config/index.js";
import { createLogger } from "../src/utils/logger.js";
import type { EnvConfig } from "../src/config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimum valid production config — override specific fields per test. */
function makeConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    NODE_ENV: "production",
    PORT: 3000,
    HOST: "0.0.0.0",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "https://app.vervedental.com.au",
    JWT_ACCESS_SECRET: "prod-access-secret-minimum-32-characters-long",
    JWT_REFRESH_SECRET: "prod-refresh-secret-minimum-32-characters-long",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
    DATABASE_URL: "postgres://user:pass@db.example.com/verve",
    DATABASE_SSL: "auto",
    REDIS_URL: "redis://cache.example.com:6379",
    REDIS_TLS: "auto",
    MFA_ENCRYPTION_KEY: "0".repeat(64),
    ...overrides,
  };
}

const silentLogger = createLogger({ LOG_LEVEL: "silent" });

// ---------------------------------------------------------------------------
// Production — URL-absent guards (network-free: throw before any connect())
// ---------------------------------------------------------------------------

describe("Production startup guard — missing DATABASE_URL", () => {
  it("throws before connecting when DATABASE_URL is absent", async () => {
    const config = makeConfig({ DATABASE_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /DATABASE_URL.*required.*production/i,
    );
  });

  it("error message mentions refusing to start with in-memory repositories", async () => {
    const config = makeConfig({ DATABASE_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /in-memory/i,
    );
  });
});

describe("Production startup guard — missing REDIS_URL", () => {
  it("throws before connecting when REDIS_URL is absent", async () => {
    const config = makeConfig({ REDIS_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /REDIS_URL.*required.*production/i,
    );
  });

  it("error message mentions session storage", async () => {
    const config = makeConfig({ REDIS_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /session/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Non-production — in-memory fallback is preserved
// ---------------------------------------------------------------------------

describe("Non-production startup — in-memory fallback allowed", () => {
  it("starts successfully in development with no DATABASE_URL and no REDIS_URL", async () => {
    const config = makeConfig({
      NODE_ENV: "development",
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });

    const deps = await createAppDependencies(config, silentLogger);

    expect(deps).toBeDefined();
    expect(deps.databasePool).toBeNull();
    expect(deps.redisClient).toBeNull();
    expect(deps.authService).toBeDefined();
    expect(deps.userRepository).toBeDefined();

    await deps.shutdown();
  });

  it("starts successfully in test mode with no DATABASE_URL and no REDIS_URL", async () => {
    const config = makeConfig({
      NODE_ENV: "test",
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });

    const deps = await createAppDependencies(config, silentLogger);

    expect(deps).toBeDefined();
    expect(deps.databasePool).toBeNull();
    expect(deps.redisClient).toBeNull();

    await deps.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Staging — infrastructure fail-closed (network-free: throw before connect())
// ---------------------------------------------------------------------------

describe("Staging startup guard — missing DATABASE_URL", () => {
  it("throws before connecting when DATABASE_URL is absent", async () => {
    const config = makeConfig({ NODE_ENV: "staging", DATABASE_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /DATABASE_URL.*required.*staging/i,
    );
  });

  it("error message mentions refusing to start with in-memory repositories", async () => {
    const config = makeConfig({ NODE_ENV: "staging", DATABASE_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /in-memory/i,
    );
  });
});

describe("Staging startup guard — missing REDIS_URL", () => {
  it("throws before connecting when REDIS_URL is absent", async () => {
    const config = makeConfig({ NODE_ENV: "staging", REDIS_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /REDIS_URL.*required.*staging/i,
    );
  });

  it("error message mentions session storage", async () => {
    const config = makeConfig({ NODE_ENV: "staging", REDIS_URL: undefined });

    await expect(createAppDependencies(config, silentLogger)).rejects.toThrow(
      /session/i,
    );
  });
});

// ---------------------------------------------------------------------------
// CORS hardening — wildcard and localhost rejection for staging and production
//
// Uses assertDeployedCorsOrigin() directly (it receives an EnvConfig object)
// so no process.env manipulation is needed.
// ---------------------------------------------------------------------------

describe("CORS hardening — staging rejects wildcard origin", () => {
  it("throws when CORS_ORIGIN is *", () => {
    const config = makeConfig({ NODE_ENV: "staging", CORS_ORIGIN: "*" });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/wildcard/i);
  });

  it("throws when CORS_ORIGIN is empty string", () => {
    const config = makeConfig({ NODE_ENV: "staging", CORS_ORIGIN: "" });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/wildcard.*or.*empty|empty.*or.*wildcard/i);
  });

  it("throws when CORS_ORIGIN list contains a wildcard entry", () => {
    const config = makeConfig({
      NODE_ENV: "staging",
      CORS_ORIGIN: "https://staging.vervedental.com.au,*",
    });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/wildcard/i);
  });

  it("throws when CORS_ORIGIN contains only localhost", () => {
    const config = makeConfig({
      NODE_ENV: "staging",
      CORS_ORIGIN: "http://localhost:5173",
    });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/staging/i);
  });

  it("passes for a valid HTTPS staging origin", () => {
    const config = makeConfig({
      NODE_ENV: "staging",
      CORS_ORIGIN: "https://staging.vervedental.com.au",
    });

    expect(() => { assertDeployedCorsOrigin(config); }).not.toThrow();
  });
});

describe("CORS hardening — production rejects wildcard origin", () => {
  it("throws when CORS_ORIGIN is *", () => {
    const config = makeConfig({ NODE_ENV: "production", CORS_ORIGIN: "*" });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/wildcard/i);
  });

  it("throws when CORS_ORIGIN is empty string", () => {
    const config = makeConfig({ NODE_ENV: "production", CORS_ORIGIN: "" });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/wildcard.*or.*empty|empty.*or.*wildcard/i);
  });

  it("throws when CORS_ORIGIN list contains a wildcard entry", () => {
    const config = makeConfig({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.vervedental.com.au,*",
    });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/wildcard/i);
  });

  it("throws when CORS_ORIGIN contains only localhost", () => {
    const config = makeConfig({
      NODE_ENV: "production",
      CORS_ORIGIN: "http://localhost:5173",
    });

    expect(() => { assertDeployedCorsOrigin(config); }).toThrow(/production/i);
  });

  it("passes for a valid HTTPS production origin", () => {
    const config = makeConfig({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.vervedental.com.au",
    });

    expect(() => { assertDeployedCorsOrigin(config); }).not.toThrow();
  });
});

describe("CORS hardening — development allows local and wildcard configuration", () => {
  it("permits CORS_ORIGIN=* in development", () => {
    const config = makeConfig({ NODE_ENV: "development", CORS_ORIGIN: "*" });

    expect(() => { assertDeployedCorsOrigin(config); }).not.toThrow();
  });

  it("permits localhost origin in development", () => {
    const config = makeConfig({
      NODE_ENV: "development",
      CORS_ORIGIN: "http://localhost:5173",
    });

    expect(() => { assertDeployedCorsOrigin(config); }).not.toThrow();
  });
});
