import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  // Cloud hosts (Render, Railway, etc.) inject PORT dynamically.
  PORT: z.coerce.number().int().positive().default(3000),
  // Bind address for the HTTP server. Use 0.0.0.0 in cloud environments.
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Comma-separated list of allowed CORS origins.
  // Staging/production: must be explicit HTTPS frontend URL(s) — wildcard (*) is rejected.
  // Development/test: defaults to http://localhost:5173; wildcard is permitted.
  // Example: https://app.vervedental.com.au,https://staging.vervedental.com.au
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  DATABASE_URL: z.string().url().optional(),
  // auto: enable SSL for remote hosts / sslmode=require URLs; true/false to force.
  DATABASE_SSL: z.enum(["auto", "true", "false"]).default("auto"),
  REDIS_URL: z.string().url().optional(),
  // auto: enable TLS when REDIS_URL uses rediss://; true/false to force.
  REDIS_TLS: z.enum(["auto", "true", "false"]).default("auto"),
  /**
   * 64-character hex string (32 bytes) used for AES-256-GCM encryption of
   * TOTP secrets at rest.  Generate with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   * Required when MFA enrollment is active.
   */
  MFA_ENCRYPTION_KEY: z
    .string()
    .min(64, "MFA_ENCRYPTION_KEY must be at least 64 hex characters (32 bytes)"),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates CORS_ORIGIN for deployed environments (staging and production).
 *
 * Rules enforced in staging and production:
 *   • Wildcard (*) is rejected — it is incompatible with cookie-based auth
 *     and is a misconfiguration signal.
 *   • Empty origin list is rejected.
 *   • Localhost-only origins are rejected — they indicate a missing deployment
 *     configuration rather than a valid deployed setup.
 *
 * Development and test are unrestricted (this function is a no-op for them).
 *
 * Exported so config-validation tests can call it directly with an EnvConfig
 * object rather than manipulating process.env.
 */
export function assertDeployedCorsOrigin(config: EnvConfig): void {
  if (config.NODE_ENV !== "production" && config.NODE_ENV !== "staging") {
    return;
  }

  const origins = config.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || origins.includes("*")) {
    throw new Error(
      `CORS_ORIGIN must not be wildcard (*) or empty when NODE_ENV=${config.NODE_ENV} — ` +
        "set it to your deployed frontend HTTPS URL(s)",
    );
  }

  const onlyLocalOrigins = origins.every(
    (origin) =>
      origin.includes("localhost") || origin.includes("127.0.0.1"),
  );

  if (onlyLocalOrigins) {
    throw new Error(
      `CORS_ORIGIN must be set to your ${config.NODE_ENV} frontend URL(s) when NODE_ENV=${config.NODE_ENV}`,
    );
  }
}

export function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted)}`);
  }

  assertDeployedCorsOrigin(result.data);

  return result.data;
}
