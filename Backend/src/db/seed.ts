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
import { SEED_ORGANISATION_ID } from "../repositories/organisationRepository.js";
import { SEED_LEGAL_ENTITY_ID } from "../repositories/legalEntityRepository.js";
import {
  SEED_SUPPLIER_A_ID,
  SEED_SUPPLIER_B_ID,
  SEED_RELATIONSHIP_A1_ID,
  SEED_RELATIONSHIP_B1_ID,
  SEED_RELATIONSHIP_A2_ID,
} from "../repositories/supplierRelationshipRepository.js";
import {
  SEED_CONTRACT_DENTAL_DEPOT_ID,
  SEED_CONTRACT_MEDIGATE_EXPIRED_ID,
} from "../repositories/supplierContractRepository.js";
import {
  SEED_CONTRACT_PRICE_GLOVES_ID,
  SEED_CONTRACT_PRICE_COMPOSITE_ID,
  SEED_CONTRACT_PRICE_MATRIX_ID,
  SEED_CONTRACT_PRICE_GLOVES_PROMO_ID,
} from "../repositories/supplierContractPriceRepository.js";
import { SEED_POLICY_IDS } from "../repositories/procurementPolicyRepository.js";
import {
  buildBarcodeMappingSeed,
  buildClinicInventorySeed,
  buildMasterCatalogSeed,
  SEED_MASTER_CATALOG_IDS,
} from "../repositories/seed/inventorySeed.js";
import type { UserRole } from "../types/auth.js";
import type { Logger } from "../utils/logger.js";
import { AUTH_BYPASS_CLINIC_ID, withTenantContext } from "./tenantContext.js";
import type { DatabasePool } from "./pool.js";

// ─── Organisation seed ────────────────────────────────────────────────────────

/**
 * Seed the default "Verve Demo Organisation" on first boot.
 *
 * Uses ON CONFLICT (id) DO NOTHING so the function is safe to call on every
 * cold start.  Must run before seedClinics so the organisation row exists
 * when the clinic backfill references it.
 *
 * Backfill: all existing clinics that have organisation_id IS NULL are
 * assigned to the default organisation.  This is idempotent — clinics
 * already linked are untouched.
 */
export async function seedOrganisation(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  await pool.query(
    `INSERT INTO organisations (id, name, status)
     VALUES ($1, $2, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [SEED_ORGANISATION_ID, "Verve Demo Organisation"],
  );

  // Backfill: assign all clinics without an organisation to the seed org.
  const { rowCount } = await pool.query(
    `UPDATE clinics
     SET organisation_id = $1
     WHERE organisation_id IS NULL`,
    [SEED_ORGANISATION_ID],
  );

  const updated = rowCount ?? 0;
  if (updated > 0) {
    logger.info(
      { organisationId: SEED_ORGANISATION_ID, clinicsUpdated: updated },
      "Backfilled existing clinics to default organisation",
    );
  } else {
    logger.info(
      { organisationId: SEED_ORGANISATION_ID },
      "Default organisation seeded — no clinic backfill needed",
    );
  }
}

// ─── Legal Entity seed ────────────────────────────────────────────────────────

/**
 * Seed the default demo legal entity on first boot.
 *
 * Uses ON CONFLICT (id) DO NOTHING so the function is safe to call on every
 * cold start.  Must run AFTER seedOrganisation so the organisation row exists
 * when the FK constraint is evaluated.
 *
 * Does NOT backfill existing clinics — legal_entity_id is nullable and clinics
 * operate correctly without one.  Any explicit clinic-to-entity linkage is done
 * via the API by an owner_admin.
 */
export async function seedLegalEntity(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  await pool.query(
    `INSERT INTO legal_entities
       (id, organisation_id, legal_name, trading_name, country_code, currency_code, status)
     VALUES ($1, $2, $3, $4, 'AU', 'AUD', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [
      SEED_LEGAL_ENTITY_ID,
      SEED_ORGANISATION_ID,
      "Verve Demo Holdings Pty Ltd",
      "Verve Dental",
    ],
  );

  logger.info(
    { legalEntityId: SEED_LEGAL_ENTITY_ID, organisationId: SEED_ORGANISATION_ID },
    "Default legal entity seeded",
  );
}

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

// ─── Demo Supplier seed ────────────────────────────────────────────────────────

type DemoSupplier = {
  id: string;
  supplierName: string;
  supplierCode: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  abn: string | null;
  supplierCategory: string | null;
  healthcareSubcategory: string | null;
  verified: boolean;
};

const DEMO_SUPPLIERS: DemoSupplier[] = [
  {
    id: SEED_SUPPLIER_A_ID,
    supplierName: "Dental Depot Australia",
    supplierCode: "DDA-001",
    email: "orders@dentaldepot.com.au",
    phone: "1800 123 456",
    website: "https://www.dentaldepot.com.au",
    abn: "12 345 678 901",
    supplierCategory: "Dental Supplies",
    healthcareSubcategory: "Dental",
    verified: true,
  },
  {
    id: SEED_SUPPLIER_B_ID,
    supplierName: "Medigate Medical Supplies",
    supplierCode: "MMS-001",
    email: "procurement@medigate.com.au",
    phone: "1800 654 321",
    website: "https://www.medigate.com.au",
    abn: "98 765 432 109",
    supplierCategory: "Medical Supplies",
    healthcareSubcategory: "Dental",
    verified: false,
  },
];

/**
 * Seed demo supplier records into PostgreSQL on first boot.
 *
 * Uses ON CONFLICT (id) DO NOTHING so the function is safe to call on every
 * cold start.  suppliers table has no RLS — safe to use pool.query directly.
 */
export async function seedDemoSuppliers(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  let seeded = 0;
  for (const supplier of DEMO_SUPPLIERS) {
    const { rowCount } = await pool.query(
      `INSERT INTO suppliers
         (id, supplier_name, supplier_code, email, phone, website, abn,
          supplier_category, healthcare_subcategory, verified,
          country_code, currency_code, is_public, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'AU', 'AUD', true, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        supplier.id,
        supplier.supplierName,
        supplier.supplierCode,
        supplier.email,
        supplier.phone,
        supplier.website,
        supplier.abn,
        supplier.supplierCategory,
        supplier.healthcareSubcategory,
        supplier.verified,
      ],
    );
    seeded += rowCount ?? 0;
  }

  if (seeded > 0) {
    logger.info({ count: seeded }, "Demo suppliers seeded into PostgreSQL");
  } else {
    logger.info("Demo suppliers already present — skipping supplier seed");
  }
}

// ─── Supplier Relationship seed ────────────────────────────────────────────────

type DemoRelationship = {
  id: string;
  supplierId: string;
  clinicId: string;
  preferredSupplier: boolean;
  accountNumber: string | null;
  creditTerms: string | null;
};

const DEMO_RELATIONSHIPS: DemoRelationship[] = [
  {
    id: SEED_RELATIONSHIP_A1_ID,
    supplierId: SEED_SUPPLIER_A_ID,
    clinicId: SEED_CLINIC_A_ID,
    preferredSupplier: true,
    accountNumber: "ACC-CLA-001",
    creditTerms: "30 days net",
  },
  {
    id: SEED_RELATIONSHIP_B1_ID,
    supplierId: SEED_SUPPLIER_B_ID,
    clinicId: SEED_CLINIC_A_ID,
    preferredSupplier: false,
    accountNumber: "ACC-CLA-002",
    creditTerms: "COD",
  },
  {
    id: SEED_RELATIONSHIP_A2_ID,
    supplierId: SEED_SUPPLIER_A_ID,
    clinicId: SEED_CLINIC_B_ID,
    preferredSupplier: true,
    accountNumber: "ACC-CLB-001",
    creditTerms: "30 days net",
  },
];

/**
 * Seed demo supplier relationship records on first boot.
 *
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 * supplier_relationships has no RLS — safe to use pool.query directly.
 */
export async function seedSupplierRelationships(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  let seeded = 0;
  for (const rel of DEMO_RELATIONSHIPS) {
    const { rowCount } = await pool.query(
      `INSERT INTO supplier_relationships
         (id, supplier_id, clinic_id, relationship_status, preferred_supplier,
          account_number, credit_terms)
       VALUES ($1, $2, $3, 'active', $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        rel.id,
        rel.supplierId,
        rel.clinicId,
        rel.preferredSupplier,
        rel.accountNumber,
        rel.creditTerms,
      ],
    );
    seeded += rowCount ?? 0;
  }

  if (seeded > 0) {
    logger.info(
      { count: seeded },
      "Demo supplier relationships seeded into PostgreSQL",
    );
  } else {
    logger.info(
      "Demo supplier relationships already present — skipping relationship seed",
    );
  }
}

// ─── Procurement Policy seed ───────────────────────────────────────────────────

type DemoPolicy = {
  id: string;
  clinicId: string;
  supplierRelationshipId: string;
  masterCatalogItemId: string | null;
  policyName: string;
  priority: number;
  preferredSupplier: boolean;
  allowFallback: boolean;
  fallbackPriority: number | null;
  minimumOrderQuantity: number | null;
  preferredOrderDay: string | null;
  priceDifferenceThresholdPercent: number | null;
  approvalRequired: boolean;
  reorderStrategy: string;
  notes: string | null;
};

const DEMO_POLICIES: DemoPolicy[] = [
  {
    id: SEED_POLICY_IDS.clinicAGlovesPreferred,
    clinicId: SEED_CLINIC_A_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_A1_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
    policyName: "Nitrile Gloves — Preferred Supplier",
    priority: 1,
    preferredSupplier: true,
    allowFallback: true,
    fallbackPriority: 2,
    minimumOrderQuantity: 5,
    preferredOrderDay: "monday",
    priceDifferenceThresholdPercent: 5,
    approvalRequired: false,
    reorderStrategy: "standard",
    notes: "Primary glove supplier — 30 day net terms",
  },
  {
    id: SEED_POLICY_IDS.clinicAGlovesFallback,
    clinicId: SEED_CLINIC_A_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_B1_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
    policyName: "Nitrile Gloves — Fallback Supplier",
    priority: 2,
    preferredSupplier: false,
    allowFallback: false,
    fallbackPriority: null,
    minimumOrderQuantity: null,
    preferredOrderDay: null,
    priceDifferenceThresholdPercent: null,
    approvalRequired: true,
    reorderStrategy: "standard",
    notes: "Use only when primary supplier is unable to supply",
  },
  {
    id: SEED_POLICY_IDS.clinicAGeneralPreferred,
    clinicId: SEED_CLINIC_A_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_A1_ID,
    masterCatalogItemId: null,
    policyName: "General Consumables — Preferred Supplier",
    priority: 1,
    preferredSupplier: true,
    allowFallback: false,
    fallbackPriority: null,
    minimumOrderQuantity: null,
    preferredOrderDay: "monday",
    priceDifferenceThresholdPercent: null,
    approvalRequired: false,
    reorderStrategy: "standard",
    notes: null,
  },
];

/**
 * Seed demo procurement policy records on first boot.
 *
 * Development/test only — restricted by the isDemoSeedEnv guard in dependencies.ts.
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 * procurement_policies has no RLS currently — safe to use pool.query directly.
 */
export async function seedProcurementPolicies(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  let seeded = 0;
  for (const policy of DEMO_POLICIES) {
    const { rowCount } = await pool.query(
      `INSERT INTO procurement_policies
         (id, clinic_id, supplier_relationship_id, master_catalog_item_id,
          policy_name, policy_status, priority, preferred_supplier,
          allow_fallback, fallback_priority, minimum_order_quantity,
          preferred_order_day, price_difference_threshold_percent,
          approval_required, reorder_strategy, notes)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING`,
      [
        policy.id,
        policy.clinicId,
        policy.supplierRelationshipId,
        policy.masterCatalogItemId,
        policy.policyName,
        policy.priority,
        policy.preferredSupplier,
        policy.allowFallback,
        policy.fallbackPriority,
        policy.minimumOrderQuantity,
        policy.preferredOrderDay,
        policy.priceDifferenceThresholdPercent,
        policy.approvalRequired,
        policy.reorderStrategy,
        policy.notes,
      ],
    );
    seeded += rowCount ?? 0;
  }

  if (seeded > 0) {
    logger.info(
      { count: seeded },
      "Demo procurement policies seeded into PostgreSQL",
    );
  } else {
    logger.info(
      "Demo procurement policies already present — skipping policy seed",
    );
  }
}

// ─── Supplier Contract seed ───────────────────────────────────────────────────

type DemoContract = {
  id: string;
  supplierRelationshipId: string;
  contractName: string;
  contractNumber: string | null;
  status: string;
  startDate: string;
  endDate: string;
  renewalNoticeDays: number;
  paymentTerms: string;
  freightTerms: string | null;
  minimumOrderValueCents: number | null;
  estimatedAnnualCommitmentCents: number | null;
  annualSpendTargetCents: number | null;
};

const DEMO_CONTRACTS: DemoContract[] = [
  {
    id: SEED_CONTRACT_DENTAL_DEPOT_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_A1_ID,
    contractName: "2026 Supply Agreement",
    contractNumber: "DD-2026-CLA-001",
    status: "active",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    renewalNoticeDays: 90,
    paymentTerms: "30 days net",
    freightTerms: "Free over $500",
    minimumOrderValueCents: 25000,
    estimatedAnnualCommitmentCents: 8000000,
    annualSpendTargetCents: 7500000,
  },
  {
    id: SEED_CONTRACT_MEDIGATE_EXPIRED_ID,
    supplierRelationshipId: SEED_RELATIONSHIP_B1_ID,
    contractName: "2025 Supply Agreement",
    contractNumber: "MG-2025-CLA-001",
    status: "expired",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    renewalNoticeDays: 60,
    paymentTerms: "COD",
    freightTerms: null,
    minimumOrderValueCents: null,
    estimatedAnnualCommitmentCents: null,
    annualSpendTargetCents: null,
  },
];

/**
 * Seed demo supplier contract records on first boot.
 *
 * Development/test only — restricted by the isDemoSeedEnv guard in dependencies.ts.
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 * supplier_contracts has no RLS — safe to use pool.query directly.
 */
export async function seedSupplierContracts(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  let seeded = 0;
  for (const contract of DEMO_CONTRACTS) {
    const { rowCount } = await pool.query(
      `INSERT INTO supplier_contracts
         (id, supplier_relationship_id, contract_name, contract_number,
          status, start_date, end_date, renewal_notice_days,
          payment_terms, freight_terms, minimum_order_value_cents,
          estimated_annual_commitment_cents, annual_spend_target_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        contract.id,
        contract.supplierRelationshipId,
        contract.contractName,
        contract.contractNumber,
        contract.status,
        contract.startDate,
        contract.endDate,
        contract.renewalNoticeDays,
        contract.paymentTerms,
        contract.freightTerms,
        contract.minimumOrderValueCents,
        contract.estimatedAnnualCommitmentCents,
        contract.annualSpendTargetCents,
      ],
    );
    seeded += rowCount ?? 0;
  }

  if (seeded > 0) {
    logger.info(
      { count: seeded },
      "Demo supplier contracts seeded into PostgreSQL",
    );
  } else {
    logger.info(
      "Demo supplier contracts already present — skipping contract seed",
    );
  }
}

// ─── Supplier Contract Price seed ─────────────────────────────────────────────

type DemoContractPrice = {
  id: string;
  supplierContractId: string;
  masterCatalogItemId: string;
  priceType: string;
  unitPriceCents: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  minimumQuantity: number | null;
  maximumQuantity: number | null;
  currencyCode: string;
  notes: string | null;
};

const DEMO_CONTRACT_PRICES: DemoContractPrice[] = [
  {
    id: SEED_CONTRACT_PRICE_GLOVES_ID,
    supplierContractId: SEED_CONTRACT_DENTAL_DEPOT_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
    priceType: "contract",
    unitPriceCents: 1320,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: null,
  },
  {
    id: SEED_CONTRACT_PRICE_COMPOSITE_ID,
    supplierContractId: SEED_CONTRACT_DENTAL_DEPOT_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.compositeResin,
    priceType: "contract",
    unitPriceCents: 4690,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: null,
  },
  {
    id: SEED_CONTRACT_PRICE_MATRIX_ID,
    supplierContractId: SEED_CONTRACT_DENTAL_DEPOT_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.matrixBands,
    priceType: "contract",
    unitPriceCents: 2410,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: null,
  },
  {
    id: SEED_CONTRACT_PRICE_GLOVES_PROMO_ID,
    supplierContractId: SEED_CONTRACT_DENTAL_DEPOT_ID,
    masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
    priceType: "promotional",
    unitPriceCents: 1280,
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-07-31",
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: "End-of-financial-year promotional pricing",
  },
];

/**
 * Seed demo supplier contract price records on first boot.
 *
 * Development/test only — restricted by the isDemoSeedEnv guard in dependencies.ts.
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 * supplier_contract_prices has no RLS — safe to use pool.query directly.
 * Must run after seedSupplierContracts and seedInventory (FK dependencies).
 */
export async function seedSupplierContractPrices(
  pool: DatabasePool,
  logger: Logger,
): Promise<void> {
  let seeded = 0;
  for (const price of DEMO_CONTRACT_PRICES) {
    const { rowCount } = await pool.query(
      `INSERT INTO supplier_contract_prices
         (id, supplier_contract_id, master_catalog_item_id,
          price_type, unit_price_cents,
          effective_from, effective_to,
          minimum_quantity, maximum_quantity,
          currency_code, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        price.id,
        price.supplierContractId,
        price.masterCatalogItemId,
        price.priceType,
        price.unitPriceCents,
        price.effectiveFrom,
        price.effectiveTo,
        price.minimumQuantity,
        price.maximumQuantity,
        price.currencyCode,
        price.notes,
      ],
    );
    seeded += rowCount ?? 0;
  }

  if (seeded > 0) {
    logger.info(
      { count: seeded },
      "Demo supplier contract prices seeded into PostgreSQL",
    );
  } else {
    logger.info(
      "Demo supplier contract prices already present — skipping price seed",
    );
  }
}
