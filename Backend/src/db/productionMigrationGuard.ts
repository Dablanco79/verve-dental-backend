import type { DatabasePool } from "./pool.js";
import {
  BOOTSTRAP_MIGRATIONS,
  runBootstrapMigrations,
} from "./migrate.js";
import type { Logger } from "../utils/logger.js";

export type ProductionMigrationGuardMode = "apply" | "verify";

export type ProductionDatabaseIdentity = {
  databaseName: string;
  systemIdentifier: string;
};

export const PRODUCTION_TARGET_MIGRATION_IDS = [
  "060_leave_coverage_groups",
  "061_clinic_brand_assets",
] as const;

const RELEASE_MIGRATION_IDS = BOOTSTRAP_MIGRATIONS.map(
  (migration) => migration.id,
);
const BASELINE_MIGRATION_IDS = RELEASE_MIGRATION_IDS.slice(
  0,
  -PRODUCTION_TARGET_MIGRATION_IDS.length,
);

function assertApprovedReleaseShape(): void {
  const expectedTail = [
    "059_force_workflow_table_rls",
    ...PRODUCTION_TARGET_MIGRATION_IDS,
  ];
  const actualTail = RELEASE_MIGRATION_IDS.slice(-expectedTail.length);
  const tailMatches = expectedTail.every(
    (id, index) => actualTail[index] === id,
  );

  if (
    BASELINE_MIGRATION_IDS.length !== 57 ||
    RELEASE_MIGRATION_IDS.length !== 59 ||
    !tailMatches ||
    RELEASE_MIGRATION_IDS.some((id) => id.startsWith("058_"))
  ) {
    throw new Error(
      "[Migration Guard] Release migration registration no longer matches the approved 57-to-59 migration plan.",
    );
  }
}

export async function runProductionGuardedMigration(
  pool: DatabasePool,
  logger: Logger,
  mode: ProductionMigrationGuardMode,
  identity: ProductionDatabaseIdentity,
): Promise<void> {
  assertApprovedReleaseShape();

  if (!identity.databaseName.trim() || !/^\d+$/.test(identity.systemIdentifier)) {
    throw new Error(
      "[Migration Guard] Expected Production database identity is missing or invalid.",
    );
  }

  const isApply = mode === "apply";
  await runBootstrapMigrations(pool, logger, {
    nodeEnv: "production",
    mode: isApply ? "apply" : "verify",
    productionGuard: {
      expectedDatabaseName: identity.databaseName,
      expectedSystemIdentifier: identity.systemIdentifier,
      expectedAppliedIds: isApply
        ? BASELINE_MIGRATION_IDS
        : RELEASE_MIGRATION_IDS,
      expectedPendingIds: isApply
        ? PRODUCTION_TARGET_MIGRATION_IDS
        : [],
    },
  });
}
