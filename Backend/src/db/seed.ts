/**
 * Seed demo users into PostgreSQL on first boot.
 *
 * Runs only when the users table is empty — safe to call on every cold start.
 * Passwords are bcrypt-hashed at runtime; nothing sensitive is hardcoded.
 *
 * MFA is disabled for all seeded accounts because real TOTP is wired in
 * Module 04+. The DEV_MFA_CODE bypass is blocked in production, so leaving
 * mfa_enabled = true would prevent login until TOTP is implemented.
 *
 * SECURITY: Demo seeding is disabled outside development and test environments.
 * Passing env="staging" or env="production" is a no-op — the function returns
 * immediately without touching the database.
 */

import bcrypt from "bcryptjs";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "../repositories/userRepository.js";
import {
  buildBarcodeMappingSeed,
  buildClinicInventorySeed,
  buildMasterCatalogSeed,
} from "../repositories/seed/inventorySeed.js";
import type { UserRole } from "../types/auth.js";
import type { Logger } from "../utils/logger.js";
import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "./tenantContext.js";
import type { DatabasePool } from "./pool.js";

// ─── Clinic seed ──────────────────────────────────────────────────────────────

type SeedClinic = {
  id: string;
  name: string;
  timezone: string;
  subscriptionTier: string;
};

const SEED_CLINICS: SeedClinic[] = [
  {
    id: SEED_CLINIC_A_ID,
    name: "Verve Dental Clinic A",
    timezone: "Australia/Sydney",
    subscriptionTier: "standard",
  },
  {
    id: SEED_CLINIC_B_ID,
    name: "Verve Dental Clinic B",
    timezone: "Australia/Sydney",
    subscriptionTier: "standard",
  },
];

/**
 * Seed the canonical clinics table with Clinic A and Clinic B on first boot.
 *
 * Uses ON CONFLICT (id) DO NOTHING so:
 *   • Fresh databases get both rows inserted.
 *   • Existing databases are left untouched — safe to call on every cold start.
 *
 * Must be called BEFORE seedDemoUsers() so the clinic rows exist when any
 * future FK constraint from users → clinics is enforced.
 */
export async function seedClinics(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM clinics",
  );

  const existingCount = parseInt(rows[0]?.count ?? "0", 10);

  if (existingCount > 0) {
    logger.info(
      { clinicCount: existingCount },
      "Clinics table already populated — skipping clinic seed",
    );
    return;
  }

  for (const clinic of SEED_CLINICS) {
    await pool.query(
      `INSERT INTO clinics (id, name, timezone, subscription_tier, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO NOTHING`,
      [clinic.id, clinic.name, clinic.timezone, clinic.subscriptionTier],
    );
  }

  logger.info(
    { count: SEED_CLINICS.length },
    "Demo clinics seeded into PostgreSQL",
  );
}

const DEMO_PASSWORD = "password123";

type DemoUser = {
  id: string;
  email: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
};

const DEMO_USERS: DemoUser[] = [
  {
    id: SEED_USER_IDS.clinicAAdmin,
    email: "admin@clinic-a.au",
    role: "owner_admin",
    homeClinicId: SEED_CLINIC_A_ID,
    homeClinicName: "Verve Dental Clinic A",
  },
  {
    id: SEED_USER_IDS.clinicAManager,
    email: "manager@clinic-a.au",
    role: "group_practice_manager",
    homeClinicId: SEED_CLINIC_A_ID,
    homeClinicName: "Verve Dental Clinic A",
  },
  {
    id: SEED_USER_IDS.clinicAStaff,
    email: "staff@clinic-a.au",
    role: "clinical_staff",
    homeClinicId: SEED_CLINIC_A_ID,
    homeClinicName: "Verve Dental Clinic A",
  },
  {
    id: SEED_USER_IDS.clinicBAdmin,
    email: "admin@clinic-b.au",
    role: "owner_admin",
    homeClinicId: SEED_CLINIC_B_ID,
    homeClinicName: "Verve Dental Clinic B",
  },
];

export async function seedDemoUsers(
  pool: DatabasePool,
  logger: Logger,
  env: string,
): Promise<void> {
  if (env !== "development" && env !== "test") {
    logger.warn(
      { env },
      "Demo user seeding is disabled in this environment — skipping (only runs in development/test)",
    );
    return;
  }

  // The users table has FORCE ROW LEVEL SECURITY (migration 015).
  // Seed runs before any request context exists, so we must use owner_admin
  // mode to bypass the tenant policy.  This is safe: seed only runs on a
  // fresh, empty database where there is no cross-tenant data to protect.
  await withTenantContext(
    pool,
    AUTH_BYPASS_CLINIC_ID,
    async (client) => {
      const { rows } = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users",
      );

      const existingCount = parseInt(rows[0]?.count ?? "0", 10);

      if (existingCount > 0) {
        logger.info(
          { userCount: existingCount },
          "Users table already populated — skipping demo seed",
        );
        return;
      }

      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

      for (const user of DEMO_USERS) {
        await client.query(
          `INSERT INTO users
             (id, email, password_hash, role, home_clinic_id, home_clinic_name, mfa_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, false)
           ON CONFLICT (id) DO NOTHING`,
          [
            user.id,
            user.email,
            passwordHash,
            user.role,
            user.homeClinicId,
            user.homeClinicName,
          ],
        );
      }

      logger.info(
        { count: DEMO_USERS.length },
        "Demo users seeded into PostgreSQL (password: password123, mfa_enabled: false)",
      );
    },
    true, // ownerAdmin — bypass RLS for bootstrap seed
  );
}

/**
 * Seed demo inventory data into PostgreSQL on first boot.
 *
 * Runs only when master_catalog_items is empty — safe to call on every
 * cold start. Uses the same fixed UUIDs as the in-memory seed so test
 * assertions and dev barcodes work identically against both repos.
 *
 * RLS NOTE: master_catalog_items and barcode_mappings have no RLS (global
 * shared tables).  clinic_inventory_items has FORCE RLS, so its inserts
 * are wrapped in owner_admin context (same as seedDemoUsers).
 */
export async function seedInventory(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM master_catalog_items",
  );

  const existingCount = parseInt(rows[0]?.count ?? "0", 10);

  if (existingCount > 0) {
    logger.info(
      { itemCount: existingCount },
      "master_catalog_items already populated — skipping inventory seed",
    );
    return;
  }

  const masterItems = buildMasterCatalogSeed();
  const barcodeMappings = buildBarcodeMappingSeed();
  const clinicInventory = buildClinicInventorySeed();

  // master_catalog_items and barcode_mappings: no RLS, safe to use pool.query
  for (const item of masterItems) {
    await pool.query(
      `INSERT INTO master_catalog_items
         (id, sku, name, description, category, unit_of_measure,
          default_unit_cost_cents, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        item.id,
        item.sku,
        item.name,
        item.description ?? null,
        item.category,
        item.unitOfMeasure,
        item.defaultUnitCostCents,
        item.isActive,
        item.createdAt,
        item.updatedAt,
      ],
    );
  }

  for (const mapping of barcodeMappings) {
    await pool.query(
      `INSERT INTO barcode_mappings
         (id, master_catalog_item_id, barcode_value, barcode_format, is_primary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        mapping.id,
        mapping.masterCatalogItemId,
        mapping.barcodeValue,
        mapping.barcodeFormat,
        mapping.isPrimary,
        mapping.createdAt,
      ],
    );
  }

  // clinic_inventory_items: has FORCE RLS — must use owner_admin context
  await withTenantContext(
    pool,
    AUTH_BYPASS_CLINIC_ID,
    async (client) => {
      for (const stockItem of clinicInventory) {
        await client.query(
          `INSERT INTO clinic_inventory_items
             (id, clinic_id, master_catalog_item_id, quantity_on_hand, reorder_point,
              unit_cost_override_cents, supplier_preference, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            stockItem.id,
            stockItem.clinicId,
            stockItem.masterCatalogItemId,
            stockItem.quantityOnHand,
            stockItem.reorderPoint,
            stockItem.unitCostOverrideCents ?? null,
            stockItem.supplierPreference ?? null,
            stockItem.createdAt,
            stockItem.updatedAt,
          ],
        );
      }
    },
    true, // ownerAdmin — bypass RLS for bootstrap seed
  );

  logger.info(
    {
      masterItems: masterItems.length,
      barcodeMappings: barcodeMappings.length,
      clinicInventoryItems: clinicInventory.length,
    },
    "Demo inventory seeded into PostgreSQL",
  );
}
