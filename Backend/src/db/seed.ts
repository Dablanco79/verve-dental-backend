/**
 * Seed demo users into PostgreSQL on first boot.
 *
 * Runs only when the users table is empty — safe to call on every cold start.
 * Passwords are bcrypt-hashed at runtime; nothing sensitive is hardcoded.
 *
 * MFA is disabled for all seeded accounts because real TOTP is wired in
 * Module 04+. The DEV_MFA_CODE bypass is blocked in production, so leaving
 * mfa_enabled = true would prevent login until TOTP is implemented.
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
import type { DatabasePool } from "./pool.js";

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
): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
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
    await pool.query(
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
}

/**
 * Seed demo inventory data into PostgreSQL on first boot.
 *
 * Runs only when master_catalog_items is empty — safe to call on every
 * cold start. Uses the same fixed UUIDs as the in-memory seed so test
 * assertions and dev barcodes work identically against both repos.
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

  for (const stockItem of clinicInventory) {
    await pool.query(
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

  logger.info(
    {
      masterItems: masterItems.length,
      barcodeMappings: barcodeMappings.length,
      clinicInventoryItems: clinicInventory.length,
    },
    "Demo inventory seeded into PostgreSQL",
  );
}
