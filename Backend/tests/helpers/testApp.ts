import type { Express } from "express";

import { createApp } from "../../src/app.js";
import { createAppDependencies } from "../../src/bootstrap/dependencies.js";
import { loadConfig } from "../../src/config/index.js";
import { createLogger } from "../../src/utils/logger.js";

export const TEST_JWT_ACCESS_SECRET = "test-access-secret-minimum-32-characters-long";
export const TEST_JWT_REFRESH_SECRET = "test-refresh-secret-minimum-32-characters-long";

export async function createTestApp(): Promise<Express> {
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
  process.env.CORS_ORIGIN = "http://localhost:5173";
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  const config = loadConfig();
  const logger = createLogger(config);
  const deps = await createAppDependencies(config, logger);

  return createApp(config, logger, deps);
}
