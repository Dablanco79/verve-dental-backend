import type { EnvConfig } from "../config/index.js";
import { createDatabasePool } from "../db/pool.js";
import { createInMemoryCatalogRepository } from "../repositories/catalogRepository.js";
import { createInMemoryInventoryRepository } from "../repositories/inventoryRepository.js";
import { createInMemoryUserRepository } from "../repositories/userRepository.js";
import { createRedisClient } from "../redis/client.js";
import { createAuditService } from "../services/auditService.js";
import { createAuthService } from "../services/authService.js";
import type { Logger } from "../utils/logger.js";
import type { DatabasePool } from "../db/pool.js";
import type { RedisClient } from "../redis/client.js";

export type AppDependencies = {
  authService: ReturnType<typeof createAuthService>;
  auditService: ReturnType<typeof createAuditService>;
  catalogRepository: ReturnType<typeof createInMemoryCatalogRepository>;
  inventoryRepository: ReturnType<typeof createInMemoryInventoryRepository>;
  databasePool: DatabasePool | null;
  redisClient: RedisClient | null;
  shutdown: () => Promise<void>;
};

export async function createAppDependencies(
  config: EnvConfig,
  logger: Logger,
): Promise<AppDependencies> {
  const userRepository = await createInMemoryUserRepository();
  const catalogRepository = createInMemoryCatalogRepository();
  const inventoryRepository = createInMemoryInventoryRepository(catalogRepository);
  const auditService = createAuditService(logger);
  const authService = createAuthService(config, userRepository, auditService);

  const databasePool = createDatabasePool(config);
  const redisClient = createRedisClient(config);

  if (databasePool) {
    await databasePool.query("SELECT 1");
    logger.info("PostgreSQL connection pool ready");
  }

  if (redisClient) {
    await redisClient.connect();
    logger.info("Redis client connected");
  }

  async function shutdown(): Promise<void> {
    await Promise.all([
      databasePool?.end(),
      redisClient?.quit().catch(() => undefined),
    ]);
  }

  return {
    authService,
    auditService,
    catalogRepository,
    inventoryRepository,
    databasePool,
    redisClient,
    shutdown,
  };
}
