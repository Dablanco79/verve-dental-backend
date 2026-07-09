import type { EnvConfig } from "../config/index.js";
import { runBootstrapMigrations } from "../db/migrate.js";
import { createDatabasePool } from "../db/pool.js";
import {
  seedClinics,
  seedDemoSuppliers,
  seedDemoUsers,
  seedInventory,
  seedLegalEntity,
  seedOrganisation,
  seedProcurementPolicies,
  seedSupplierContracts,
  seedSupplierContractPrices,
  seedSupplierRelationships,
} from "../db/seed.js";
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
  createInMemoryPermissionRepository,
} from "../repositories/permissionRepository.js";
import { createPostgresPermissionRepository } from "../repositories/permissionRepository.postgres.js";
import {
  createInMemoryBillingRepository,
} from "../repositories/billingRepository.js";
import { createPostgresBillingRepository } from "../repositories/billingRepository.postgres.js";
import {
  createInMemorySupplierRepository,
} from "../repositories/supplierRepository.js";
import { createPostgresSupplierRepository } from "../repositories/supplierRepository.postgres.js";
import {
  createInMemorySupplierCatalogueRepository,
} from "../repositories/supplierCatalogueRepository.js";
import { createPostgresSupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.postgres.js";
import {
  createInMemorySupplierInvoiceRepository,
} from "../repositories/supplierInvoiceRepository.js";
import { createPostgresSupplierInvoiceRepository } from "../repositories/supplierInvoiceRepository.postgres.js";
import {
  createInMemoryOrganisationRepository,
} from "../repositories/organisationRepository.js";
import { createPostgresOrganisationRepository } from "../repositories/organisationRepository.postgres.js";
import {
  createInMemoryLegalEntityRepository,
} from "../repositories/legalEntityRepository.js";
import { createPostgresLegalEntityRepository } from "../repositories/legalEntityRepository.postgres.js";
import {
  createInMemorySupplierRelationshipRepository,
} from "../repositories/supplierRelationshipRepository.js";
import { createPostgresSupplierRelationshipRepository } from "../repositories/supplierRelationshipRepository.postgres.js";
import {
  createInMemoryProcurementPolicyRepository,
} from "../repositories/procurementPolicyRepository.js";
import { createPostgresProcurementPolicyRepository } from "../repositories/procurementPolicyRepository.postgres.js";
import {
  createInMemorySupplierContractRepository,
} from "../repositories/supplierContractRepository.js";
import { createPostgresSupplierContractRepository } from "../repositories/supplierContractRepository.postgres.js";
import {
  createInMemorySupplierContractPriceRepository,
} from "../repositories/supplierContractPriceRepository.js";
import { createPostgresSupplierContractPriceRepository } from "../repositories/supplierContractPriceRepository.postgres.js";
import { createOcrProvider } from "../services/ocr/ocrProviderFactory.js";
import { createSupplierInvoiceService } from "../services/supplierInvoiceService.js";
import { createSupplierIntelligenceService } from "../services/supplierIntelligenceService.js";
import { installRlsPoolHook } from "../db/tenantContext.js";
import { createRedisClient } from "../redis/client.js";
import { createAnalyticsService } from "../services/analyticsService.js";
import { createAuditService } from "../services/auditService.js";
import { createAuthService } from "../services/authService.js";
import { createBillingService } from "../services/billingService.js";
import { createHealthService } from "../services/healthService.js";
import { createLeaveService } from "../services/leaveService.js";
import { createPurchaseOrderService } from "../services/purchaseOrderService.js";
import { createSupplierService } from "../services/supplierService.js";
import { createSupplierCatalogueService } from "../services/supplierCatalogueService.js";
import { createCatalogueImportService } from "../services/catalogueImportService.js";
import { createMasterProductImportService } from "../services/masterProductImportService.js";
import { createMasterProductService } from "../services/masterProductService.js";
import { createProductMatchingService } from "../services/productMatchingService.js";
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
import type { PermissionRepository } from "../repositories/permissionRepository.js";
import type { SupplierRepository } from "../repositories/supplierRepository.js";
import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import type { SupplierInvoiceRepository } from "../repositories/supplierInvoiceRepository.js";
import type { OrganisationRepository } from "../repositories/organisationRepository.js";
import type { LegalEntityRepository } from "../repositories/legalEntityRepository.js";
import type { SupplierRelationshipRepository } from "../repositories/supplierRelationshipRepository.js";
import type { ProcurementPolicyRepository } from "../repositories/procurementPolicyRepository.js";
import type { SupplierContractRepository } from "../repositories/supplierContractRepository.js";
import type { SupplierContractPriceRepository } from "../repositories/supplierContractPriceRepository.js";
import type { AnalyticsService } from "../services/analyticsService.js";
import type { SupplierInvoiceService } from "../services/supplierInvoiceService.js";
import type { SupplierIntelligenceService } from "../services/supplierIntelligenceService.js";
import type { BillingService } from "../services/billingService.js";
import type { HealthService } from "../services/healthService.js";
import type { LeaveService } from "../services/leaveService.js";
import type { PurchaseOrderService } from "../services/purchaseOrderService.js";
import type { SupplierService } from "../services/supplierService.js";
import type { SupplierCatalogueService } from "../services/supplierCatalogueService.js";
import type { CatalogueImportService } from "../services/catalogueImportService.js";
import type { MasterProductImportService } from "../services/masterProductImportService.js";
import type { MasterProductService } from "../services/masterProductService.js";
import type { ProductMatchingService } from "../services/productMatchingService.js";

export type AppDependencies = {
  authService: ReturnType<typeof createAuthService>;
  auditService: ReturnType<typeof createAuditService>;
  userService: ReturnType<typeof createUserService>;
  timesheetService: ReturnType<typeof createTimesheetService>;
  leaveService: LeaveService;
  billingService: BillingService;
  analyticsService: AnalyticsService;
  purchaseOrderService: PurchaseOrderService;
  supplierService: SupplierService;
  supplierCatalogueService: SupplierCatalogueService;
  catalogueImportService: CatalogueImportService;
  masterProductImportService: MasterProductImportService;
  masterProductService: MasterProductService;
  productMatchingService: ProductMatchingService;
  supplierInvoiceService: SupplierInvoiceService;
  supplierIntelligenceService: SupplierIntelligenceService;
  healthService: HealthService;
  userRepository: UserRepository;
  permissionRepository: PermissionRepository;
  catalogRepository: CatalogRepository;
  clinicRepository: ClinicRepository;
  inventoryRepository: InventoryRepository;
  rosterRepository: RosterRepository;
  timesheetRepository: TimesheetRepository;
  leaveRepository: LeaveRepository;
  billingRepository: BillingRepository;
  analyticsRepository: AnalyticsRepository;
  supplierRepository: SupplierRepository;
  supplierCatalogueRepository: SupplierCatalogueRepository;
  supplierInvoiceRepository: SupplierInvoiceRepository;
  organisationRepository: OrganisationRepository;
  legalEntityRepository: LegalEntityRepository;
  supplierRelationshipRepository: SupplierRelationshipRepository;
  procurementPolicyRepository: ProcurementPolicyRepository;
  supplierContractRepository: SupplierContractRepository;
  supplierContractPriceRepository: SupplierContractPriceRepository;
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
  let permissionRepository: PermissionRepository;
  let catalogRepository: CatalogRepository;
  let clinicRepository: ClinicRepository;
  let inventoryRepository: InventoryRepository;
  let rosterRepository: RosterRepository;
  let timesheetRepository: TimesheetRepository;
  let leaveRepository: LeaveRepository;
  let billingRepository: BillingRepository;
  let analyticsRepository: AnalyticsRepository;
  let supplierRepository: SupplierRepository;
  let supplierCatalogueRepository: SupplierCatalogueRepository;
  let supplierInvoiceRepository: SupplierInvoiceRepository;
  let organisationRepository: OrganisationRepository;
  let legalEntityRepository: LegalEntityRepository;
  let supplierRelationshipRepository: SupplierRelationshipRepository;
  let procurementPolicyRepository: ProcurementPolicyRepository;
  let supplierContractRepository: SupplierContractRepository;
  let supplierContractPriceRepository: SupplierContractPriceRepository;

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
      await seedOrganisation(connectedPool, logger);
      await seedLegalEntity(connectedPool, logger);
      await seedClinics(connectedPool, logger);
      await seedDemoUsers(connectedPool, logger, config.NODE_ENV);
      await seedInventory(connectedPool, logger);
      await seedDemoSuppliers(connectedPool, logger);
      await seedSupplierRelationships(connectedPool, logger);
      await seedProcurementPolicies(connectedPool, logger);
      await seedSupplierContracts(connectedPool, logger);
      await seedSupplierContractPrices(connectedPool, logger);
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
    permissionRepository = createPostgresPermissionRepository(connectedPool);
    catalogRepository = createPostgresCatalogRepository(connectedPool);
    clinicRepository = createPostgresClinicRepository(connectedPool);
    inventoryRepository = createPostgresInventoryRepository(connectedPool);
    rosterRepository = createPostgresRosterRepository(connectedPool);
    timesheetRepository = createPostgresTimesheetRepository(connectedPool);
    leaveRepository = createPostgresLeaveRepository(connectedPool);
    billingRepository = createPostgresBillingRepository(connectedPool);
    analyticsRepository = createPostgresAnalyticsRepository(connectedPool);
    supplierRepository = createPostgresSupplierRepository(connectedPool);
    supplierCatalogueRepository = createPostgresSupplierCatalogueRepository(connectedPool);
    supplierInvoiceRepository = createPostgresSupplierInvoiceRepository(connectedPool);
    organisationRepository = createPostgresOrganisationRepository(connectedPool);
    legalEntityRepository = createPostgresLegalEntityRepository(connectedPool);
    supplierRelationshipRepository =
      createPostgresSupplierRelationshipRepository(connectedPool);
    procurementPolicyRepository =
      createPostgresProcurementPolicyRepository(connectedPool);
    supplierContractRepository =
      createPostgresSupplierContractRepository(connectedPool);
    supplierContractPriceRepository =
      createPostgresSupplierContractPriceRepository(connectedPool);

    logger.info(
      "Using PostgreSQL repositories (users, catalog, clinic, inventory, roster, timesheet, leave, billing, analytics, suppliers, organisations, legal-entities, supplier-relationships, procurement-policies, supplier-contracts, supplier-contract-prices)",
    );
  } else {
    userRepository = await createInMemoryUserRepository(config.MFA_ENCRYPTION_KEY);
    permissionRepository = createInMemoryPermissionRepository();
    catalogRepository = createInMemoryCatalogRepository();
    clinicRepository = createInMemoryClinicRepository();
    inventoryRepository = createInMemoryInventoryRepository(catalogRepository);
    rosterRepository = createInMemoryRosterRepository();
    timesheetRepository = createInMemoryTimesheetRepository();
    leaveRepository = createInMemoryLeaveRepository();
    billingRepository = createInMemoryBillingRepository();
    analyticsRepository = createInMemoryAnalyticsRepository();
    supplierRepository = createInMemorySupplierRepository();
    supplierCatalogueRepository = createInMemorySupplierCatalogueRepository();
    supplierInvoiceRepository = createInMemorySupplierInvoiceRepository();
    organisationRepository = createInMemoryOrganisationRepository();
    legalEntityRepository = createInMemoryLegalEntityRepository();
    supplierRelationshipRepository =
      createInMemorySupplierRelationshipRepository();
    procurementPolicyRepository =
      createInMemoryProcurementPolicyRepository();
    supplierContractRepository =
      createInMemorySupplierContractRepository();
    supplierContractPriceRepository =
      createInMemorySupplierContractPriceRepository();

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

  const healthService = createHealthService(connectedPool, connectedRedis);
  const auditService = createAuditService(logger, analyticsRepository);
  const authService = createAuthService(config, userRepository, auditService, connectedRedis, permissionRepository);
  const userService = createUserService(userRepository, auditService, authService);
  const purchaseOrderService = createPurchaseOrderService(
    inventoryRepository,
    catalogRepository,
    auditService,
    analyticsRepository,
    supplierCatalogueRepository,
    supplierRepository,
  );

  // Supplier Intelligence — Sprint 3.
  // Requires a real database pool (uses raw SQL with CTEs).
  // Falls back to a no-op stub that returns empty results in in-memory mode.
  const supplierIntelligenceService = connectedPool
    ? createSupplierIntelligenceService(connectedPool)
    : {
        getIntelligence: (clinicId: string) =>
          Promise.resolve({
            clinicId,
            generatedAt: new Date().toISOString(),
            summary: {
              totalPotentialAnnualSavingCents: 0,
              productsWithSaving: 0,
              averagePriceVariancePct: null as number | null,
              productsNeedingAttention: 0,
            },
            opportunities: [] as import("../types/supplierIntelligence.js").SupplierIntelligenceRow[],
            needsAttention: [] as import("../types/supplierIntelligence.js").SupplierIntelligenceRow[],
          }),
      };

  const supplierService = createSupplierService(supplierRepository, auditService);

  const productMatchingService = createProductMatchingService(
    catalogRepository,
    supplierCatalogueRepository,
  );

  const supplierCatalogueService = createSupplierCatalogueService(
    supplierCatalogueRepository,
    supplierRepository,
    catalogRepository,
    auditService,
  );

  const catalogueImportService = createCatalogueImportService(
    supplierCatalogueRepository,
    supplierRepository,
    productMatchingService,
    catalogRepository,
    inventoryRepository,
  );

  const masterProductImportService = createMasterProductImportService(
    catalogRepository,
    inventoryRepository,
    auditService,
  );
  const masterProductService = createMasterProductService(catalogRepository, auditService);

  // Supplier Invoice OCR — Sprint OCR-1.
  // createOcrProvider reads OCR_PROVIDER + ANTHROPIC_API_KEY from config.
  // Falls back to StubOcrProvider in development/test when API key is absent.
  const ocrProvider = createOcrProvider(config);
  const supplierInvoiceService = createSupplierInvoiceService(
    supplierInvoiceRepository,
    ocrProvider,
    supplierCatalogueRepository,
    auditService,
    supplierRepository,
    supplierRelationshipRepository,
    catalogRepository,
    inventoryRepository,
  );
  const timesheetService = createTimesheetService(
    timesheetRepository,
    userRepository,
    rosterRepository,
  );
  const leaveService = createLeaveService(leaveRepository, rosterRepository, analyticsRepository);
  const billingService = createBillingService(billingRepository, analyticsRepository);
  const analyticsService = createAnalyticsService(
    analyticsRepository,
    billingRepository,
    inventoryRepository,
    rosterRepository,
    userRepository,
    clinicRepository,
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
    supplierService,
    supplierCatalogueService,
    catalogueImportService,
    masterProductImportService,
    masterProductService,
    productMatchingService,
    supplierInvoiceService,
    supplierIntelligenceService,
    healthService,
    userRepository,
    permissionRepository,
    catalogRepository,
    clinicRepository,
    inventoryRepository,
    rosterRepository,
    timesheetRepository,
    leaveRepository,
    billingRepository,
    analyticsRepository,
    supplierRepository,
    supplierCatalogueRepository,
    supplierInvoiceRepository,
    organisationRepository,
    legalEntityRepository,
    supplierRelationshipRepository,
    procurementPolicyRepository,
    supplierContractRepository,
    supplierContractPriceRepository,
    databasePool: connectedPool,
    redisClient: connectedRedis,
    shutdown,
  };
}
