import type { EnvConfig } from "../config/index.js";
import { runBootstrapMigrations } from "../db/migrate.js";
import { createDatabasePool } from "../db/pool.js";
import { seedClinics, seedDemoUsers, seedInventory } from "../db/seed.js";
import {
  createInMemoryAnalyticsRepository,
} from "../repositories/analyticsRepository.js";
import { createPostgresAnalyticsRepository } from "../repositories/analyticsRepository.postgres.js";
import { createInMemoryCatalogRepository } from "../repositories/catalogRepository.js";
import { createPostgresCatalogRepository } from "../repositories/catalogRepository.postgres.js";
import {
  createInMemoryClinicRepository,
} from "../repositories/clinicRepository.js";
import { createPostgresClinicRepository } from "../repositories/clinicRepository.postgres.js";
import { createInMemoryInventoryRepository } from "../repositories/inventoryRepository.js";
import { createPostgresInventoryRepository } from "../repositories/inventoryRepository.postgres.js";
import {
  createInMemoryRosterRepository,
} from "../repositories/rosterRepository.js";
import { createPostgresRosterRepository } from "../repositories/rosterRepository.postgres.js";
import {
  createInMemoryTimesheetRepository,
} from "../repositories/timesheetRepository.js";
import { createPostgresTimesheetRepository } from "../repositories/timesheetRepository.postgres.js";
import {
  createInMemoryLeaveRepository,
} from "../repositories/leaveRepository.js";
import { createPostgresLeaveRepository } from "../repositories/leaveRepository.postgres.js";
import {
  createInMemoryUserRepository,
} from "../repositories/userRepository.js";
import { createPostgresUserRepository } from "../repositories/userRepository.postgres.js";
import {
  createInMemoryBillingRepository,
} from "../repositories/billingRepository.js";
import { createPostgresBillingRepository } from "../repositories/billingRepository.postgres.js";
import { installRlsPoolHook } from "../db/tenantContext.js";
import { createRedisClient } from "../redis/client.js";
import { createAnalyticsService } from "../services/analyticsService.js";
import { createAuditService } from "../services/auditService.js";
import { createAuthService } from "../services/authService.js";
import { createBillingService } from "../services/billingService.js";
import { createLeaveService } from "../services/leaveService.js";
import { createPurchaseOrderService } from "../services/purchaseOrderService.js";
import { createTimesheetService } from "../services/timesheetService.js";
import { createUserService } from "../services/userService.js";
import type { Logger } from "../utils/logger.js";
import type { DatabasePool } from "../db/pool.js";
import type { RedisClient } from "../redis/client.js";
import type { AnalyticsRepository } from "../repositories/analyticsRepository.js";
import type { BillingRepository } from "../repositories/billingRepository.js";
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { ClinicRepository } from "../repositories/clinicRepository.js";
import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { LeaveRepository } from "../repositories/leaveRepository.js";
import type { RosterRepository } from "../repositories/rosterRepository.js";
import type { TimesheetRepository } from "../repositories/timesheetRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";
import type { AnalyticsService } from "../services/analyticsService.js";
import type { BillingService } from "../services/billingService.js";
import type { LeaveService } from "../services/leaveService.js";
import type { PurchaseOrderService } from "../services/purchaseOrderService.js";

export type AppDependencies = {
  authService: ReturnType<typeof createAuthService>;
  auditService: ReturnType<typeof createAuditService>;
  userService: ReturnType<typeof createUserService>;
  timesheetService: ReturnType<typeof createTimesheetService>;
  leaveService: LeaveService;
  billingService: BillingService;
  analyticsService: AnalyticsService;
  purchaseOrderService: PurchaseOrderService;
  userRepository: UserRepository;
  catalogRepository: CatalogRepository;
  clinicRepository: ClinicRepository;
  inventoryRepository: InventoryRepository;
  rosterRepository: RosterRepository;
  timesheetRepository: TimesheetRepository;
  leaveRepository: LeaveRepository;
  billingRepository: BillingRepository;
  analyticsRepository: AnalyticsRepository;
  databasePool: DatabasePool | null;
  redisClient: RedisClient | null;
  shutdown: () => Promise<void>;
};

export async function createAppDependencies(
  config: EnvConfig,
  logger: Logger,
): Promise<AppDependencies> {
  // ---------------------------------------------------------------------------
  // Deployed-environment startup guard — fail fast if required infrastructure
  // is absent in staging or production.
  //
  // In development / test the in-memory fallbacks keep the server runnable
  // without real infra.  In staging and production, starting without a real
  // database or Redis session store is a misconfiguration, not a graceful
  // degradation.
  // ---------------------------------------------------------------------------
  if (config.NODE_ENV === "production" || config.NODE_ENV === "staging") {
    if (!config.DATABASE_URL) {
      throw new Error(
        `DATABASE_URL is required in ${config.NODE_ENV} — refusing to start with in-memory repositories`,
      );
    }
    if (!config.REDIS_URL) {
      throw new Error(
        `REDIS_URL is required in ${config.NODE_ENV} — refusing to start without Redis for session storage`,
      );
    }
  }

  const auditService = createAuditService(logger);
  const databasePool = createDatabasePool(config);
  const redisClient = createRedisClient(config);

  // Register the error guard BEFORE any connect() call.  ioredis emits an
  // 'error' event on ECONNREFUSED; without a listener Node.js treats it as an
  // unhandled exception and crashes the process.
  if (redisClient) {
    redisClient.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        return; // Swallowed: server runs without local Redis caching.
      }
      logger.warn(`Redis error: ${err.message}`);
    });
  }

  let userRepository: UserRepository;
  let catalogRepository: CatalogRepository;
  let clinicRepository: ClinicRepository;
  let inventoryRepository: InventoryRepository;
  let rosterRepository: RosterRepository;
  let timesheetRepository: TimesheetRepository;
  let leaveRepository: LeaveRepository;
  let billingRepository: BillingRepository;
  let analyticsRepository: AnalyticsRepository;

  // Tracks the pool only when we have confirmed the DB is reachable.
  // Stays null if DATABASE_URL is absent OR if the probe receives ECONNREFUSED.
  let connectedPool: DatabasePool | null = null;

  if (databasePool) {
    try {
      await databasePool.query("SELECT 1");
      connectedPool = databasePool;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : "";
      const isRefused = code === "ECONNREFUSED" || message.includes("ECONNREFUSED");

      // In production, any connection failure is a fatal startup error.
      if (!isRefused || config.NODE_ENV === "production") throw err;

      logger.warn(
        "⚠️  Local PG DB not running — falling back to Mock/In-Memory mode",
      );
      // Release the dead pool so the process does not hold open file descriptors.
      await databasePool.end().catch(() => undefined);
    }
  }

  if (connectedPool) {
    logger.info("PostgreSQL connection pool ready");

    await runBootstrapMigrations(connectedPool, logger, {
      nodeEnv: config.NODE_ENV,
      migrateOnStartup: config.MIGRATE_ON_STARTUP,
    });

    // Bootstrap seed order — sequence is load-bearing:
    //   1. clinics        — no RLS; must exist before users (future FK guard)
    //   2. seedDemoUsers  — FORCE RLS on users table; seed fn uses owner_admin context
    //   3. seedInventory  — global catalog (no RLS) + clinic_inventory_items (FORCE RLS)
    //   4. installRlsPoolHook — installed AFTER seeds; seed fns manage their own
    //                           withTenantContext() calls internally and do not rely
    //                           on the per-request hook.
    //
    // SECURITY: Demo seeding is restricted to development and test.  In staging
    // and production these calls are skipped entirely.  seedDemoUsers() also
    // enforces this internally as a second line of defence.
    const isDemoSeedEnv =
      config.NODE_ENV === "development" || config.NODE_ENV === "test";

    if (isDemoSeedEnv) {
      await seedClinics(connectedPool, logger);
      await seedDemoUsers(connectedPool, logger, config.NODE_ENV);
      await seedInventory(connectedPool, logger);
    } else {
      // Warn operators when the users table is empty so they know they must
      // create an initial admin account through proper onboarding — not seeding.
      const { rows } = await connectedPool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users",
      );
      const userCount = parseInt(rows[0]?.count ?? "0", 10);
      if (userCount === 0) {
        logger.warn(
          { env: config.NODE_ENV },
          "⚠️  Users table is empty and demo seeding is disabled (NODE_ENV=%s). " +
            "Create an initial admin account before accepting traffic.",
          config.NODE_ENV,
        );
      }
    }

    // Install the AsyncLocalStorage hook AFTER migrations and seeds so that
    // RLS policies are in place and seed data exists before the hook starts
    // injecting per-request tenant context onto pooled connections.
    installRlsPoolHook(connectedPool);
    logger.info("RLS pool hook installed — per-request tenant context active");

    userRepository = createPostgresUserRepository(connectedPool);
    catalogRepository = createPostgresCatalogRepository(connectedPool);
    clinicRepository = createPostgresClinicRepository(connectedPool);
    inventoryRepository = createPostgresInventoryRepository(connectedPool);
    rosterRepository = createPostgresRosterRepository(connectedPool);
    timesheetRepository = createPostgresTimesheetRepository(connectedPool);
    leaveRepository = createPostgresLeaveRepository(connectedPool);
    billingRepository = createPostgresBillingRepository(connectedPool);
    analyticsRepository = createPostgresAnalyticsRepository(connectedPool);

    logger.info(
      "Using PostgreSQL repositories (users, catalog, clinic, inventory, roster, timesheet, leave, billing, analytics)",
    );
  } else {
    userRepository = await createInMemoryUserRepository(config.MFA_ENCRYPTION_KEY);
    catalogRepository = createInMemoryCatalogRepository();
    clinicRepository = createInMemoryClinicRepository();
    inventoryRepository = createInMemoryInventoryRepository(catalogRepository);
    rosterRepository = createInMemoryRosterRepository();
    timesheetRepository = createInMemoryTimesheetRepository();
    leaveRepository = createInMemoryLeaveRepository();
    billingRepository = createInMemoryBillingRepository();
    analyticsRepository = createInMemoryAnalyticsRepository();

    if (!databasePool) {
      logger.warn(
        "DATABASE_URL not set — using in-memory repositories (state lost on restart)",
      );
    }
  }

  // Connect Redis before building services so authService can use it for
  // refresh-token storage. Gracefully degrades to in-memory Map when absent.
  let connectedRedis: RedisClient | null = null;

  if (redisClient) {
    try {
      await redisClient.connect();
      connectedRedis = redisClient;
      logger.info("Redis client connected");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : "";
      const isRefused =
        code === "ECONNREFUSED" ||
        message.includes("ECONNREFUSED") ||
        message.includes("Connection is closed");

      // In production, any connection failure is a fatal startup error.
      if (!isRefused || config.NODE_ENV === "production") throw err;

      logger.warn("⚠️  Local Redis not running — session caching disabled");
      await redisClient.quit().catch(() => undefined);
    }
  }

  const authService = createAuthService(config, userRepository, auditService, connectedRedis);
  const userService = createUserService(userRepository, auditService, authService);
  const purchaseOrderService = createPurchaseOrderService(
    inventoryRepository,
    catalogRepository,
    auditService,
  );
  const timesheetService = createTimesheetService(
    timesheetRepository,
    userRepository,
    rosterRepository,
  );
  const leaveService = createLeaveService(leaveRepository, rosterRepository);
  const billingService = createBillingService(billingRepository, analyticsRepository);
  const analyticsService = createAnalyticsService(
    analyticsRepository,
    billingRepository,
    inventoryRepository,
    rosterRepository,
    userRepository,
  );

  async function shutdown(): Promise<void> {
    await Promise.all([
      connectedPool?.end(),
      connectedRedis?.quit().catch(() => undefined),
    ]);
  }

  return {
    authService,
    auditService,
    userService,
    timesheetService,
    leaveService,
    billingService,
    analyticsService,
    purchaseOrderService,
    userRepository,
    catalogRepository,
    clinicRepository,
    inventoryRepository,
    rosterRepository,
    timesheetRepository,
    leaveRepository,
    billingRepository,
    analyticsRepository,
    databasePool: connectedPool,
    redisClient: connectedRedis,
    shutdown,
  };
}
