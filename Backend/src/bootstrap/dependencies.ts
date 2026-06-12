import type { EnvConfig } from "../config/index.js";
import { runBootstrapMigrations } from "../db/migrate.js";
import { createDatabasePool } from "../db/pool.js";
import { seedDemoUsers, seedInventory } from "../db/seed.js";
import { createInMemoryCatalogRepository } from "../repositories/catalogRepository.js";
import { createPostgresCatalogRepository } from "../repositories/catalogRepository.postgres.js";
import { createInMemoryInventoryRepository } from "../repositories/inventoryRepository.js";
import { createPostgresInventoryRepository } from "../repositories/inventoryRepository.postgres.js";
import {
  createInMemoryRosterRepository,
} from "../repositories/rosterRepository.js";
import { createPostgresRosterRepository } from "../repositories/rosterRepository.postgres.js";
import {
  createInMemoryUserRepository,
} from "../repositories/userRepository.js";
import { createPostgresUserRepository } from "../repositories/userRepository.postgres.js";
import { createRedisClient } from "../redis/client.js";
import { createAuditService } from "../services/auditService.js";
import { createAuthService } from "../services/authService.js";
import { createUserService } from "../services/userService.js";
import type { Logger } from "../utils/logger.js";
import type { DatabasePool } from "../db/pool.js";
import type { RedisClient } from "../redis/client.js";
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";

export type AppDependencies = {
  authService: ReturnType<typeof createAuthService>;
  auditService: ReturnType<typeof createAuditService>;
  userService: ReturnType<typeof createUserService>;
  userRepository: UserRepository;
  catalogRepository: CatalogRepository;
  inventoryRepository: InventoryRepository;
  rosterRepository: RosterRepository;
  databasePool: DatabasePool | null;
  redisClient: RedisClient | null;
  shutdown: () => Promise<void>;
};

export async function createAppDependencies(
  config: EnvConfig,
  logger: Logger,
): Promise<AppDependencies> {
  const auditService = createAuditService(logger);
  const databasePool = createDatabasePool(config);
  const redisClient = createRedisClient(config);

  let userRepository: UserRepository;
  let catalogRepository: CatalogRepository;
  let inventoryRepository: InventoryRepository;
  let rosterRepository: RosterRepository;

  if (databasePool) {
    await databasePool.query("SELECT 1");
    logger.info("PostgreSQL connection pool ready");

    await runBootstrapMigrations(databasePool, logger);
    await seedDemoUsers(databasePool, logger);
    await seedInventory(databasePool, logger);

    userRepository = createPostgresUserRepository(databasePool);
    catalogRepository = createPostgresCatalogRepository(databasePool);
    inventoryRepository = createPostgresInventoryRepository(databasePool);
    rosterRepository = createPostgresRosterRepository(databasePool);

    logger.info("Using PostgreSQL repositories (users, catalog, inventory, roster)");
  } else {
    userRepository = await createInMemoryUserRepository();
    catalogRepository = createInMemoryCatalogRepository();
    inventoryRepository = createInMemoryInventoryRepository(catalogRepository);
    rosterRepository = createInMemoryRosterRepository();

    logger.warn(
      "DATABASE_URL not set — using in-memory repositories (state lost on restart)",
    );
  }

  const authService = createAuthService(config, userRepository, auditService);
  const userService = createUserService(userRepository, auditService, authService);

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
    userService,
    userRepository,
    catalogRepository,
    inventoryRepository,
    rosterRepository,
    databasePool,
    redisClient,
    shutdown,
  };
}
