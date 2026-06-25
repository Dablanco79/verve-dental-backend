/**
 * supplierContractPriceUnit.test.ts — Sprint 4G
 *
 * Unit tests for the Supplier Contract Price layer:
 *   1. In-memory repository (CRUD, seed data, immutable behaviour)
 *   2. Postgres repository via mock pool (SQL shape, param wiring)
 *   3. SupplierContractPriceService (RBAC, validation, 404 handling, conflict detection)
 *   4. SupplierContractPriceController (HTTP response shapes, error propagation)
 *   5. Seed idempotency
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { jest } from "@jest/globals";

import {
  createInMemorySupplierContractPriceRepository,
  SEED_CONTRACT_PRICE_GLOVES_ID,
  SEED_CONTRACT_PRICE_COMPOSITE_ID,
  SEED_CONTRACT_PRICE_MATRIX_ID,
  SEED_CONTRACT_PRICE_GLOVES_PROMO_ID,
} from "../supplierContractPriceRepository.js";
import { createPostgresSupplierContractPriceRepository } from "../supplierContractPriceRepository.postgres.js";
import { createSupplierContractPriceService } from "../../services/supplierContractPriceService.js";
import { createSupplierContractPriceHandlers } from "../../controllers/supplierContractPriceController.js";
import type { SupplierContractPriceRepository } from "../supplierContractPriceRepository.js";
import type { SupplierContractRepository } from "../supplierContractRepository.js";
import type { SupplierRelationshipRepository } from "../supplierRelationshipRepository.js";
import type { DatabasePool } from "../../db/pool.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { AppError } from "../../types/errors.js";
import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
} from "../userRepository.js";
import {
  SEED_RELATIONSHIP_A1_ID,
} from "../supplierRelationshipRepository.js";
import { SEED_CONTRACT_DENTAL_DEPOT_ID } from "../supplierContractRepository.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLINIC_A = SEED_CLINIC_A_ID;
const CLINIC_B = SEED_CLINIC_B_ID;
const RELATIONSHIP_A1 = SEED_RELATIONSHIP_A1_ID;
const CONTRACT_DD = SEED_CONTRACT_DENTAL_DEPOT_ID;
const CATALOG_NITRILE = "d1111111-1111-4111-8111-111111111111";
const CATALOG_COMPOSITE = "d3333333-3333-4333-8333-333333333333";
const NONEXISTENT_ID = "00000000-0000-4000-8000-000000000099";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOwnerAdmin(): AuthenticatedUser {
  return {
    id: "user-admin-001",
    email: "admin@test.com",
    role: "owner_admin",
    homeClinicId: CLINIC_A,
    homeClinicName: "Test Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeManager(clinicId = CLINIC_A): AuthenticatedUser {
  return {
    id: "user-mgr-001",
    email: "manager@test.com",
    role: "group_practice_manager",
    homeClinicId: clinicId,
    homeClinicName: "Test Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeStaff(): AuthenticatedUser {
  return {
    id: "user-staff-001",
    email: "staff@test.com",
    role: "clinical_staff",
    homeClinicId: CLINIC_A,
    homeClinicName: "Test Clinic A",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

/** Build a minimal mock contract repository that resolves to Clinic A. */
function makeMockContractRepo(): SupplierContractRepository {
  const getById = jest.fn().mockImplementation((...args: unknown[]) => {
    const id = args[0] as string;
    if (id === CONTRACT_DD) {
      return Promise.resolve({
        id: CONTRACT_DD,
        supplierRelationshipId: RELATIONSHIP_A1,
        contractName: "2026 Supply Agreement",
        contractNumber: null,
        status: "active",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        renewalNoticeDays: 90,
        paymentTerms: "30 days net",
        freightTerms: null,
        minimumOrderValueCents: null,
        rebateDescription: null,
        estimatedAnnualCommitmentCents: null,
        annualSpendTargetCents: null,
        contractDocumentStorageKey: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return Promise.resolve(null);
  });
  return {
    getById,
    listByRelationship: jest.fn().mockResolvedValue([] as never),
    create: jest.fn(),
    update: jest.fn(),
    expire: jest.fn(),
    terminate: jest.fn(),
    findActiveByRelationship: jest.fn().mockResolvedValue(null as never),
  } as unknown as SupplierContractRepository;
}

/** Build a minimal mock relationship repository that resolves to a given clinic. */
function makeMockRelationshipRepo(
  clinicId = CLINIC_A,
): SupplierRelationshipRepository {
  const getById = jest.fn().mockImplementation((...args: unknown[]) => {
    const id = args[0] as string;
    if (id === RELATIONSHIP_A1) {
      return Promise.resolve({
        id: RELATIONSHIP_A1,
        supplierId: "sup-001",
        clinicId,
        status: "active",
        accountNumber: null,
        primaryContactName: null,
        primaryContactEmail: null,
        primaryContactPhone: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return Promise.resolve(null);
  });
  return {
    getById,
    listByClinic: jest.fn().mockResolvedValue([] as never),
    listBySupplierId: jest.fn().mockResolvedValue([] as never),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    findActiveBySupplierAndClinic: jest.fn().mockResolvedValue(null as never),
  } as unknown as SupplierRelationshipRepository;
}

function makeMockPool(rows: unknown[] = []): {
  pool: DatabasePool;
  query: ReturnType<typeof jest.fn>;
} {
  const query = jest
    .fn()
    .mockResolvedValue({ rows, rowCount: rows.length } as never);
  return { pool: { query } as unknown as DatabasePool, query };
}

function makeRequest(
  user: AuthenticatedUser,
  params: Record<string, string> = {},
  body: unknown = {},
): { user: AuthenticatedUser; params: Record<string, string>; body: unknown; query: Record<string, unknown> } {
  return { user, params, body, query: {} };
}

function makeResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    res: { status, json } as unknown as import("express").Response,
    status,
    json,
  };
}

// ─── 1. In-memory repository tests ───────────────────────────────────────────

describe("createInMemorySupplierContractPriceRepository", () => {
  let repo: SupplierContractPriceRepository;

  beforeEach(() => {
    repo = createInMemorySupplierContractPriceRepository();
  });

  it("lists seed prices for the Dental Depot contract", async () => {
    const prices = await repo.listByContract(CONTRACT_DD);
    expect(prices.length).toBeGreaterThanOrEqual(4);
    const ids = prices.map((p) => p.id);
    expect(ids).toContain(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(ids).toContain(SEED_CONTRACT_PRICE_COMPOSITE_ID);
    expect(ids).toContain(SEED_CONTRACT_PRICE_MATRIX_ID);
    expect(ids).toContain(SEED_CONTRACT_PRICE_GLOVES_PROMO_ID);
  });

  it("returns empty list for unknown contract", async () => {
    const prices = await repo.listByContract(NONEXISTENT_ID);
    expect(prices).toHaveLength(0);
  });

  it("getById returns seed price", async () => {
    const price = await repo.getById(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(price).not.toBeNull();
    expect(price?.unitPriceCents).toBe(1320);
    expect(price?.priceType).toBe("contract");
    expect(price?.currencyCode).toBe("AUD");
  });

  it("getById returns null for unknown id", async () => {
    const price = await repo.getById(NONEXISTENT_ID);
    expect(price).toBeNull();
  });

  it("create adds a new price and returns it", async () => {
    const created = await repo.create(CONTRACT_DD, {
      masterCatalogItemId: "d2222222-2222-4222-8222-222222222222",
      priceType: "contract",
      unitPriceCents: 4599,
      effectiveFrom: new Date("2026-09-01"),
      effectiveTo: new Date("2026-09-30"),
    });
    expect(created.id).toBeDefined();
    expect(created.unitPriceCents).toBe(4599);
    expect(created.priceType).toBe("contract");
    expect(created.currencyCode).toBe("AUD");

    const fetched = await repo.getById(created.id);
    expect(fetched).not.toBeNull();
  });

  it("create defaults priceType to contract", async () => {
    const created = await repo.create(CONTRACT_DD, {
      masterCatalogItemId: CATALOG_NITRILE,
      unitPriceCents: 999,
      effectiveFrom: new Date("2026-09-01"),
      effectiveTo: new Date("2026-09-30"),
    });
    expect(created.priceType).toBe("contract");
  });

  it("update modifies only supplied fields", async () => {
    const updated = await repo.update(SEED_CONTRACT_PRICE_GLOVES_ID, {
      unitPriceCents: 1399,
      notes: "Updated price",
    });
    expect(updated).not.toBeNull();
    expect(updated?.unitPriceCents).toBe(1399);
    expect(updated?.notes).toBe("Updated price");
    expect(updated?.priceType).toBe("contract"); // unchanged
  });

  it("update returns null for unknown id", async () => {
    const result = await repo.update(NONEXISTENT_ID, { unitPriceCents: 100 });
    expect(result).toBeNull();
  });

  it("expire sets effectiveTo to today", async () => {
    const expired = await repo.expire(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(expired).not.toBeNull();
    expect(expired?.effectiveTo).not.toBeNull();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    expect(expired?.effectiveTo?.getTime()).toBe(today.getTime());
  });

  it("expire returns null for unknown id", async () => {
    const result = await repo.expire(NONEXISTENT_ID);
    expect(result).toBeNull();
  });

  it("findCurrentPrice returns current contract price", async () => {
    const asOf = new Date("2026-06-01");
    const price = await repo.findCurrentPrice(CONTRACT_DD, CATALOG_NITRILE, {
      asOf,
      priceType: "contract",
    });
    expect(price).not.toBeNull();
    expect(price?.id).toBe(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(price?.unitPriceCents).toBe(1320);
  });

  it("findCurrentPrice returns promotional price within window", async () => {
    const asOf = new Date("2026-07-15");
    const price = await repo.findCurrentPrice(CONTRACT_DD, CATALOG_NITRILE, {
      asOf,
      priceType: "promotional",
    });
    expect(price).not.toBeNull();
    expect(price?.id).toBe(SEED_CONTRACT_PRICE_GLOVES_PROMO_ID);
    expect(price?.unitPriceCents).toBe(1280);
  });

  it("findCurrentPrice returns null outside promotional window", async () => {
    const asOf = new Date("2026-08-01");
    const price = await repo.findCurrentPrice(CONTRACT_DD, CATALOG_NITRILE, {
      asOf,
      priceType: "promotional",
    });
    expect(price).toBeNull();
  });

  it("findCurrentPrice returns null for unknown contract", async () => {
    const price = await repo.findCurrentPrice(NONEXISTENT_ID, CATALOG_NITRILE);
    expect(price).toBeNull();
  });

  it("getById returns defensive copy (immutability)", async () => {
    const p1 = await repo.getById(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(p1).not.toBeNull();
    if (p1) p1.unitPriceCents = 9999;
    const p2 = await repo.getById(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(p2?.unitPriceCents).toBe(1320);
  });
});

// ─── 2. Postgres repository SQL shape tests ───────────────────────────────────

describe("createPostgresSupplierContractPriceRepository SQL shape", () => {
  it("listByContract calls pool.query with contractId", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresSupplierContractPriceRepository(pool);
    await repo.listByContract("contract-uuid");
    expect(query.mock.calls).toHaveLength(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("supplier_contract_prices");
    expect(sql).toContain("supplier_contract_id = $1");
    expect(params).toContain("contract-uuid");
  });

  it("getById calls pool.query with priceId", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresSupplierContractPriceRepository(pool);
    await repo.getById("price-uuid");
    expect(query.mock.calls).toHaveLength(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE id = $1");
    expect(params).toContain("price-uuid");
  });

  it("expire calls UPDATE with effective_to = CURRENT_DATE", async () => {
    const { pool, query } = makeMockPool([]);
    const repo = createPostgresSupplierContractPriceRepository(pool);
    await repo.expire("price-uuid");
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("effective_to = CURRENT_DATE");
  });

  it("create inserts all required columns and returns mapped domain object", async () => {
    const fakeRow = {
      id: "new-uuid",
      supplier_contract_id: "contract-uuid",
      master_catalog_item_id: CATALOG_NITRILE,
      price_type: "contract",
      unit_price_cents: 1320,
      effective_from: new Date("2026-01-01"),
      effective_to: null,
      minimum_quantity: null,
      maximum_quantity: null,
      currency_code: "AUD",
      notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { pool, query } = makeMockPool([fakeRow]);
    const repo = createPostgresSupplierContractPriceRepository(pool);
    const result = await repo.create("contract-uuid", {
      masterCatalogItemId: CATALOG_NITRILE,
      unitPriceCents: 1320,
      effectiveFrom: new Date("2026-01-01"),
    });
    expect(result.unitPriceCents).toBe(1320);
    expect(result.priceType).toBe("contract");
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO supplier_contract_prices");
    expect(sql).toContain("RETURNING");
  });

  it("update builds dynamic SET clause and returns mapped domain object", async () => {
    const fakeRow = {
      id: "price-uuid",
      supplier_contract_id: "contract-uuid",
      master_catalog_item_id: CATALOG_NITRILE,
      price_type: "contract",
      unit_price_cents: 1399,
      effective_from: new Date("2026-01-01"),
      effective_to: null,
      minimum_quantity: null,
      maximum_quantity: null,
      currency_code: "AUD",
      notes: "Updated",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { pool, query } = makeMockPool([fakeRow]);
    const repo = createPostgresSupplierContractPriceRepository(pool);
    const result = await repo.update("price-uuid", {
      unitPriceCents: 1399,
      notes: "Updated",
    });
    expect(result?.unitPriceCents).toBe(1399);
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE supplier_contract_prices");
    expect(sql).toContain("unit_price_cents");
  });
});

// ─── 3. Service tests ─────────────────────────────────────────────────────────

describe("createSupplierContractPriceService", () => {
  let priceRepo: SupplierContractPriceRepository;
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;

  beforeEach(() => {
    priceRepo = createInMemorySupplierContractPriceRepository();
    contractRepo = makeMockContractRepo();
    relRepo = makeMockRelationshipRepo(CLINIC_A);
  });

  function makeService() {
    return createSupplierContractPriceService(
      priceRepo,
      contractRepo,
      relRepo,
    );
  }

  // ── RBAC ──

  it("clinical_staff can list prices (read-only)", async () => {
    const service = makeService();
    const prices = await service.listByContract(makeStaff(), CONTRACT_DD);
    expect(prices.length).toBeGreaterThan(0);
  });

  it("clinical_staff cannot create a price — 403", async () => {
    const service = makeService();
    await expect(
      service.create(makeStaff(), CONTRACT_DD, {
        masterCatalogItemId: CATALOG_NITRILE,
        unitPriceCents: 1000,
        effectiveFrom: new Date("2026-09-01"),
        effectiveTo: new Date("2026-09-30"),
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SUPPLIER_CONTRACT_PRICE_FORBIDDEN",
    });
  });

  it("clinical_staff cannot expire a price — 403", async () => {
    const service = makeService();
    await expect(
      service.expire(makeStaff(), SEED_CONTRACT_PRICE_COMPOSITE_ID),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SUPPLIER_CONTRACT_PRICE_FORBIDDEN",
    });
  });

  it("manager from wrong clinic cannot read prices — 403 tenant violation", async () => {
    const service = makeService();
    await expect(
      service.listByContract(makeManager(CLINIC_B), CONTRACT_DD),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SUPPLIER_CONTRACT_PRICE_TENANT_VIOLATION",
    });
  });

  it("owner_admin can access any clinic's prices", async () => {
    const service = makeService();
    const prices = await service.listByContract(makeOwnerAdmin(), CONTRACT_DD);
    expect(Array.isArray(prices)).toBe(true);
  });

  it("manager from same clinic can access prices", async () => {
    const service = makeService();
    const prices = await service.listByContract(makeManager(CLINIC_A), CONTRACT_DD);
    expect(Array.isArray(prices)).toBe(true);
  });

  // ── 404 handling ──

  it("getById throws 404 for unknown price", async () => {
    const service = makeService();
    await expect(
      service.getById(makeOwnerAdmin(), NONEXISTENT_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "SUPPLIER_CONTRACT_PRICE_NOT_FOUND",
    });
  });

  it("listByContract throws 404 for unknown contract", async () => {
    const service = makeService();
    await expect(
      service.listByContract(makeOwnerAdmin(), NONEXISTENT_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "SUPPLIER_CONTRACT_NOT_FOUND",
    });
  });

  // ── Validation: unit price ──

  it("create rejects unitPriceCents = 0", async () => {
    const service = makeService();
    await expect(
      service.create(makeOwnerAdmin(), CONTRACT_DD, {
        masterCatalogItemId: CATALOG_NITRILE,
        unitPriceCents: 0,
        effectiveFrom: new Date("2026-09-01"),
        effectiveTo: new Date("2026-09-30"),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SUPPLIER_CONTRACT_PRICE_INVALID_PRICE",
    });
  });

  it("create rejects negative unitPriceCents", async () => {
    const service = makeService();
    await expect(
      service.create(makeOwnerAdmin(), CONTRACT_DD, {
        masterCatalogItemId: CATALOG_NITRILE,
        unitPriceCents: -100,
        effectiveFrom: new Date("2026-09-01"),
        effectiveTo: new Date("2026-09-30"),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  // ── Validation: dates ──

  it("create rejects effectiveTo <= effectiveFrom", async () => {
    const service = makeService();
    await expect(
      service.create(makeOwnerAdmin(), CONTRACT_DD, {
        masterCatalogItemId: CATALOG_NITRILE,
        unitPriceCents: 999,
        effectiveFrom: new Date("2026-09-30"),
        effectiveTo: new Date("2026-09-01"),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SUPPLIER_CONTRACT_PRICE_INVALID_DATES",
    });
  });

  // ── Validation: quantity tier ──

  it("create rejects minimumQuantity < 1", async () => {
    const service = makeService();
    await expect(
      service.create(makeOwnerAdmin(), CONTRACT_DD, {
        masterCatalogItemId: CATALOG_NITRILE,
        unitPriceCents: 999,
        effectiveFrom: new Date("2026-09-01"),
        effectiveTo: new Date("2026-09-30"),
        minimumQuantity: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SUPPLIER_CONTRACT_PRICE_INVALID_QUANTITY",
    });
  });

  it("create rejects maximumQuantity < minimumQuantity", async () => {
    const service = makeService();
    await expect(
      service.create(makeOwnerAdmin(), CONTRACT_DD, {
        masterCatalogItemId: CATALOG_NITRILE,
        unitPriceCents: 999,
        effectiveFrom: new Date("2026-09-01"),
        effectiveTo: new Date("2026-09-30"),
        minimumQuantity: 10,
        maximumQuantity: 5,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SUPPLIER_CONTRACT_PRICE_INVALID_QUANTITY",
    });
  });

  // ── Conflict detection ──

  it("create rejects overlapping price for same contract/product/priceType/tier", async () => {
    const service = makeService();
    // Nitrile gloves 'contract' price already exists for 2026-01-01 (open-ended)
    await expect(
      service.create(makeOwnerAdmin(), CONTRACT_DD, {
        masterCatalogItemId: CATALOG_NITRILE,
        priceType: "contract",
        unitPriceCents: 1400,
        effectiveFrom: new Date("2026-03-01"),
        effectiveTo: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "DUPLICATE_ACTIVE_CONTRACT_PRICE",
    });
  });

  it("allows non-overlapping price for same product after expiry", async () => {
    const service = makeService();
    // Expire the existing nitrile gloves contract price first
    await service.expire(makeOwnerAdmin(), SEED_CONTRACT_PRICE_GLOVES_ID);

    // Now create a new price with a future date range — should succeed
    const created = await service.create(makeOwnerAdmin(), CONTRACT_DD, {
      masterCatalogItemId: CATALOG_NITRILE,
      priceType: "contract",
      unitPriceCents: 1350,
      effectiveFrom: new Date("2026-08-01"),
      effectiveTo: new Date("2026-12-31"),
    });
    expect(created.unitPriceCents).toBe(1350);
  });

  // ── Expire ──

  it("expire throws 409 if price is already expired", async () => {
    const service = makeService();
    await service.expire(makeOwnerAdmin(), SEED_CONTRACT_PRICE_GLOVES_ID);
    await expect(
      service.expire(makeOwnerAdmin(), SEED_CONTRACT_PRICE_GLOVES_ID),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SUPPLIER_CONTRACT_PRICE_ALREADY_EXPIRED",
    });
  });

  it("expire throws 404 for unknown price", async () => {
    const service = makeService();
    await expect(
      service.expire(makeOwnerAdmin(), NONEXISTENT_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "SUPPLIER_CONTRACT_PRICE_NOT_FOUND",
    });
  });

  // ── findCurrentPrice ──

  it("findCurrentPrice returns current price for composite resin", async () => {
    const service = makeService();
    const price = await service.findCurrentPrice(
      makeOwnerAdmin(),
      CONTRACT_DD,
      CATALOG_COMPOSITE,
      { asOf: new Date("2026-06-01"), priceType: "contract" },
    );
    expect(price).not.toBeNull();
    expect(price?.unitPriceCents).toBe(4690);
  });

  it("findCurrentPrice returns null when no current price exists", async () => {
    const service = makeService();
    const price = await service.findCurrentPrice(
      makeOwnerAdmin(),
      CONTRACT_DD,
      NONEXISTENT_ID,
    );
    expect(price).toBeNull();
  });
});

// ─── 4. Controller tests ──────────────────────────────────────────────────────

describe("createSupplierContractPriceHandlers", () => {
  function buildService() {
    return createSupplierContractPriceService(
      createInMemorySupplierContractPriceRepository(),
      makeMockContractRepo(),
      makeMockRelationshipRepo(),
    );
  }

  it("listByContract returns 200 with data array", async () => {
    const handlers = createSupplierContractPriceHandlers(buildService());
    const { res, status } = makeResponse();
    const req = makeRequest(makeOwnerAdmin(), { contractId: CONTRACT_DD });
    await handlers.listByContract(
      req as unknown as import("express").Request,
      res,
    );
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getById returns 200 for existing price", async () => {
    const handlers = createSupplierContractPriceHandlers(buildService());
    const { res, status } = makeResponse();
    const req = makeRequest(makeOwnerAdmin(), { id: SEED_CONTRACT_PRICE_GLOVES_ID });
    await handlers.getById(
      req as unknown as import("express").Request,
      res,
    );
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getById propagates 404 AppError for unknown price", async () => {
    const handlers = createSupplierContractPriceHandlers(buildService());
    const { res } = makeResponse();
    const req = makeRequest(makeOwnerAdmin(), { id: NONEXISTENT_ID });
    await expect(
      handlers.getById(req as unknown as import("express").Request, res),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("create returns 201 with price data (product with no existing price)", async () => {
    const handlers = createSupplierContractPriceHandlers(buildService());
    const { res, status } = makeResponse();
    const req = makeRequest(
      makeOwnerAdmin(),
      { contractId: CONTRACT_DD },
      {
        // Diamond burs has no seed contract price — no conflict
        masterCatalogItemId: "d2222222-2222-4222-8222-222222222222",
        unitPriceCents: 4500,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      },
    );
    await handlers.create(
      req as unknown as import("express").Request,
      res,
    );
    expect(status).toHaveBeenCalledWith(201);
  });

  it("expire returns 200 with updated price", async () => {
    const handlers = createSupplierContractPriceHandlers(buildService());
    const { res, status } = makeResponse();
    const req = makeRequest(makeOwnerAdmin(), { id: SEED_CONTRACT_PRICE_MATRIX_ID });
    await handlers.expire(
      req as unknown as import("express").Request,
      res,
    );
    expect(status).toHaveBeenCalledWith(200);
  });

  it("returns 401 when no user is attached", async () => {
    const handlers = createSupplierContractPriceHandlers(buildService());
    const { res } = makeResponse();
    const req = {
      params: { contractId: CONTRACT_DD },
      body: {},
      user: undefined,
      query: {},
    } as unknown as import("express").Request;
    await expect(handlers.listByContract(req, res)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("update returns 200 with modified price", async () => {
    const handlers = createSupplierContractPriceHandlers(buildService());
    const { res, status } = makeResponse();
    const req = makeRequest(
      makeOwnerAdmin(),
      { id: SEED_CONTRACT_PRICE_GLOVES_ID },
      { notes: "Updated via PATCH" },
    );
    await handlers.update(
      req as unknown as import("express").Request,
      res,
    );
    expect(status).toHaveBeenCalledWith(200);
  });
});

// ─── 5. Seed idempotency ──────────────────────────────────────────────────────

describe("Seed data idempotency", () => {
  it("seed price IDs are stable and unique", () => {
    const ids = [
      SEED_CONTRACT_PRICE_GLOVES_ID,
      SEED_CONTRACT_PRICE_COMPOSITE_ID,
      SEED_CONTRACT_PRICE_MATRIX_ID,
      SEED_CONTRACT_PRICE_GLOVES_PROMO_ID,
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("in-memory repo starts with exactly 4 seed prices for Dental Depot", async () => {
    const repo = createInMemorySupplierContractPriceRepository();
    const prices = await repo.listByContract(CONTRACT_DD);
    expect(prices).toHaveLength(4);
  });

  it("each factory call produces an independent store", async () => {
    const repo1 = createInMemorySupplierContractPriceRepository();
    const repo2 = createInMemorySupplierContractPriceRepository();
    await repo1.expire(SEED_CONTRACT_PRICE_GLOVES_ID);
    const p1 = await repo1.getById(SEED_CONTRACT_PRICE_GLOVES_ID);
    const p2 = await repo2.getById(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(p1?.effectiveTo).not.toBeNull();
    expect(p2?.effectiveTo).toBeNull();
  });

  it("seed prices belong to the Dental Depot contract", async () => {
    const repo = createInMemorySupplierContractPriceRepository();
    const gloves = await repo.getById(SEED_CONTRACT_PRICE_GLOVES_ID);
    expect(gloves?.supplierContractId).toBe(CONTRACT_DD);
  });

  it("promotional seed price has effectiveTo set (July 2026)", async () => {
    const repo = createInMemorySupplierContractPriceRepository();
    const promo = await repo.getById(SEED_CONTRACT_PRICE_GLOVES_PROMO_ID);
    expect(promo?.priceType).toBe("promotional");
    expect(promo?.effectiveTo).not.toBeNull();
    expect(promo?.effectiveFrom.toISOString().startsWith("2026-07")).toBe(true);
  });
});
