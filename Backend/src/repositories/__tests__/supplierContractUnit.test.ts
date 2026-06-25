/**
 * supplierContractUnit.test.ts — Sprint 4F
 *
 * Unit tests for the Supplier Contract layer:
 *   1. In-memory repository (CRUD, seed data, immutable behaviour)
 *   2. Postgres repository via mock pool (SQL shape, param wiring)
 *   3. SupplierContractService (RBAC, validation rules, 404 handling)
 *   4. SupplierContractController (HTTP response shapes, error propagation)
 *   5. Seed idempotency
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { jest } from "@jest/globals";

import {
  createInMemorySupplierContractRepository,
  SEED_CONTRACT_DENTAL_DEPOT_ID,
  SEED_CONTRACT_MEDIGATE_EXPIRED_ID,
} from "../supplierContractRepository.js";
import { createPostgresSupplierContractRepository } from "../supplierContractRepository.postgres.js";
import { createSupplierContractService } from "../../services/supplierContractService.js";
import { createSupplierContractHandlers } from "../../controllers/supplierContractController.js";
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
  SEED_RELATIONSHIP_B1_ID,
} from "../supplierRelationshipRepository.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLINIC_A = SEED_CLINIC_A_ID;
const CLINIC_B = SEED_CLINIC_B_ID;
const RELATIONSHIP_A1 = SEED_RELATIONSHIP_A1_ID;
const RELATIONSHIP_B1 = SEED_RELATIONSHIP_B1_ID;

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
    id: "user-manager-001",
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

function makeMockPool(
  callResults: Array<{ rows: unknown[]; rowCount?: number }>,
) {
  let callIdx = 0;
  const query = jest.fn().mockImplementation(() => {
    const result = callResults[callIdx] ?? { rows: [], rowCount: 0 };
    callIdx++;
    return Promise.resolve({
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    });
  });
  return { pool: { query } as unknown as DatabasePool, query };
}

function makeContractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract-001",
    supplier_relationship_id: RELATIONSHIP_A1,
    contract_name: "2026 Supply Agreement",
    contract_number: "TEST-001",
    status: "active",
    start_date: new Date("2026-01-01"),
    end_date: new Date("2026-12-31"),
    renewal_notice_days: 90,
    payment_terms: "30 days net",
    freight_terms: "Free over $500",
    minimum_order_value_cents: 25000,
    rebate_description: null,
    estimated_annual_commitment_cents: 8000000,
    annual_spend_target_cents: 7500000,
    contract_document_storage_key: null,
    notes: null,
    created_at: new Date("2025-12-15"),
    updated_at: new Date("2025-12-15"),
    ...overrides,
  };
}

/**
 * Minimal in-memory relationship repository stub for service tests.
 * Returns Clinic A for RELATIONSHIP_A1 and RELATIONSHIP_B1.
 */
function makeRelationshipRepo(): SupplierRelationshipRepository {
  const getById = jest.fn().mockImplementation((...args: unknown[]) => {
    const id = args[0] as string;
    if (id === RELATIONSHIP_A1) {
      return Promise.resolve({
        id: RELATIONSHIP_A1,
        clinicId: CLINIC_A,
        supplierId: "supplier-a",
        relationshipStatus: "active",
        preferredSupplier: true,
        accountNumber: null,
        customerNumber: null,
        creditTerms: null,
        creditLimitCents: null,
        orderingEmail: null,
        deliveryAddress: null,
        invoiceAddress: null,
        representativeName: null,
        representativeEmail: null,
        representativePhone: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    if (id === RELATIONSHIP_B1) {
      return Promise.resolve({
        id: RELATIONSHIP_B1,
        clinicId: CLINIC_A,
        supplierId: "supplier-b",
        relationshipStatus: "active",
        preferredSupplier: false,
        accountNumber: null,
        customerNumber: null,
        creditTerms: null,
        creditLimitCents: null,
        orderingEmail: null,
        deliveryAddress: null,
        invoiceAddress: null,
        representativeName: null,
        representativeEmail: null,
        representativePhone: null,
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
    listBySupplier: jest.fn().mockResolvedValue([] as never),
    findByClinicAndSupplier: jest.fn().mockResolvedValue(null as never),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
  } as unknown as SupplierRelationshipRepository;
}

function makeRequest(
  user: AuthenticatedUser,
  params: Record<string, string> = {},
  body: unknown = {},
): { user: AuthenticatedUser; params: Record<string, string>; body: unknown } {
  return { user, params, body };
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

// ─── 1. In-Memory Repository ──────────────────────────────────────────────────

describe("InMemorySupplierContractRepository — seed data", () => {
  it("is pre-seeded with 2 demo contracts", async () => {
    const repo = createInMemorySupplierContractRepository();
    const a1 = await repo.listByRelationship(RELATIONSHIP_A1);
    const b1 = await repo.listByRelationship(RELATIONSHIP_B1);
    expect(a1.length).toBeGreaterThanOrEqual(1);
    expect(b1.length).toBeGreaterThanOrEqual(1);
  });

  it("active contract is seeded for RELATIONSHIP_A1", async () => {
    const repo = createInMemorySupplierContractRepository();
    const contract = await repo.getById(SEED_CONTRACT_DENTAL_DEPOT_ID);
    expect(contract).not.toBeNull();
    expect(contract?.status).toBe("active");
    expect(contract?.supplierRelationshipId).toBe(RELATIONSHIP_A1);
    expect(contract?.renewalNoticeDays).toBe(90);
    expect(contract?.minimumOrderValueCents).toBe(25000);
  });

  it("expired contract is seeded for RELATIONSHIP_B1", async () => {
    const repo = createInMemorySupplierContractRepository();
    const contract = await repo.getById(SEED_CONTRACT_MEDIGATE_EXPIRED_ID);
    expect(contract).not.toBeNull();
    expect(contract?.status).toBe("expired");
    expect(contract?.paymentTerms).toBe("COD");
  });

  it("getById returns null for unknown id", async () => {
    const repo = createInMemorySupplierContractRepository();
    const result = await repo.getById("does-not-exist");
    expect(result).toBeNull();
  });

  it("listByRelationship filters by status", async () => {
    const repo = createInMemorySupplierContractRepository();
    const active = await repo.listByRelationship(RELATIONSHIP_A1, {
      status: "active",
    });
    expect(active.every((c) => c.status === "active")).toBe(true);
  });
});

describe("InMemorySupplierContractRepository — create", () => {
  it("creates a contract with auto-generated id", async () => {
    const repo = createInMemorySupplierContractRepository();
    const contract = await repo.create(RELATIONSHIP_B1, {
      contractName: "New Contract",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      paymentTerms: "30 days net",
    });
    expect(contract.id).toBeTruthy();
    expect(contract.contractName).toBe("New Contract");
    expect(contract.status).toBe("draft");
    expect(contract.renewalNoticeDays).toBe(0);
    expect(contract.contractNumber).toBeNull();
    expect(contract.freightTerms).toBeNull();
  });

  it("create with explicit active status persists", async () => {
    const repo = createInMemorySupplierContractRepository();
    // First expire the existing active contract on A1
    await repo.expire(SEED_CONTRACT_DENTAL_DEPOT_ID);
    const contract = await repo.create(RELATIONSHIP_A1, {
      contractName: "Active Contract",
      status: "active",
      startDate: new Date("2026-06-01"),
      endDate: new Date("2027-06-01"),
      paymentTerms: "COD",
    });
    expect(contract.status).toBe("active");
  });
});

describe("InMemorySupplierContractRepository — update", () => {
  it("patches only the supplied fields", async () => {
    const repo = createInMemorySupplierContractRepository();
    const updated = await repo.update(SEED_CONTRACT_DENTAL_DEPOT_ID, {
      contractName: "2026 Amended Agreement",
      renewalNoticeDays: 60,
    });
    expect(updated?.contractName).toBe("2026 Amended Agreement");
    expect(updated?.renewalNoticeDays).toBe(60);
    expect(updated?.paymentTerms).toBe("30 days net");
  });

  it("update returns null for non-existent id", async () => {
    const repo = createInMemorySupplierContractRepository();
    const result = await repo.update("ghost-id", { contractName: "Ghost" });
    expect(result).toBeNull();
  });

  it("update with no fields returns current record unchanged", async () => {
    const repo = createInMemorySupplierContractRepository();
    const updated = await repo.update(SEED_CONTRACT_DENTAL_DEPOT_ID, {});
    expect(updated?.contractName).toBe("2026 Supply Agreement");
    expect(updated?.status).toBe("active");
  });
});

describe("InMemorySupplierContractRepository — expire and terminate", () => {
  it("expire sets status to expired", async () => {
    const repo = createInMemorySupplierContractRepository();
    const updated = await repo.expire(SEED_CONTRACT_DENTAL_DEPOT_ID);
    expect(updated?.status).toBe("expired");
  });

  it("terminate sets status to terminated", async () => {
    const repo = createInMemorySupplierContractRepository();
    const updated = await repo.terminate(SEED_CONTRACT_DENTAL_DEPOT_ID);
    expect(updated?.status).toBe("terminated");
  });

  it("expire returns null for non-existent id", async () => {
    const repo = createInMemorySupplierContractRepository();
    const result = await repo.expire("ghost-id");
    expect(result).toBeNull();
  });

  it("terminate returns null for non-existent id", async () => {
    const repo = createInMemorySupplierContractRepository();
    const result = await repo.terminate("ghost-id");
    expect(result).toBeNull();
  });
});

describe("InMemorySupplierContractRepository — findActiveByRelationship", () => {
  it("returns the active contract for RELATIONSHIP_A1", async () => {
    const repo = createInMemorySupplierContractRepository();
    const result = await repo.findActiveByRelationship(RELATIONSHIP_A1);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("active");
  });

  it("returns null when excluded id matches the only active contract", async () => {
    const repo = createInMemorySupplierContractRepository();
    const result = await repo.findActiveByRelationship(
      RELATIONSHIP_A1,
      SEED_CONTRACT_DENTAL_DEPOT_ID,
    );
    expect(result).toBeNull();
  });

  it("returns null for a relationship with no active contract", async () => {
    const repo = createInMemorySupplierContractRepository();
    const result = await repo.findActiveByRelationship(RELATIONSHIP_B1);
    expect(result).toBeNull();
  });
});

// ─── 2. Postgres Repository (mock pool) ──────────────────────────────────────

describe("PostgresSupplierContractRepository.getById", () => {
  it("queries with the correct id param", async () => {
    const row = makeContractRow({ id: "contract-001" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    const result = await repo.getById("contract-001");

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1/i);
    expect(params[0]).toBe("contract-001");
    expect(result?.id).toBe("contract-001");
    expect(result?.contractName).toBe("2026 Supply Agreement");
  });

  it("returns null when no rows found", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    const result = await repo.getById("not-found");
    expect(result).toBeNull();
  });

  it("maps snake_case row to camelCase domain object", async () => {
    const row = makeContractRow({
      contract_number: "REF-001",
      freight_terms: "Free over $500",
      minimum_order_value_cents: 25000,
      estimated_annual_commitment_cents: 8000000,
      annual_spend_target_cents: 7500000,
      renewal_notice_days: 90,
    });
    const { pool } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    const result = await repo.getById("contract-001");

    expect(result?.contractNumber).toBe("REF-001");
    expect(result?.freightTerms).toBe("Free over $500");
    expect(result?.minimumOrderValueCents).toBe(25000);
    expect(result?.estimatedAnnualCommitmentCents).toBe(8000000);
    expect(result?.annualSpendTargetCents).toBe(7500000);
    expect(result?.renewalNoticeDays).toBe(90);
    expect(result?.supplierRelationshipId).toBe(RELATIONSHIP_A1);
  });
});

describe("PostgresSupplierContractRepository.listByRelationship", () => {
  it("queries with supplier_relationship_id and ORDER BY start_date DESC", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    await repo.listByRelationship(RELATIONSHIP_A1);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE supplier_relationship_id = \$1/i);
    expect(sql).toMatch(/ORDER BY start_date DESC/i);
    expect(params[0]).toBe(RELATIONSHIP_A1);
  });

  it("adds status filter when provided", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    await repo.listByRelationship(RELATIONSHIP_A1, { status: "active" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/status = \$2/i);
    expect(params[1]).toBe("active");
  });
});

describe("PostgresSupplierContractRepository.create", () => {
  it("inserts all required columns", async () => {
    const row = makeContractRow({ id: "new-contract-id" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresSupplierContractRepository(pool);

    await repo.create(RELATIONSHIP_A1, {
      contractName: "New Contract",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      paymentTerms: "30 days net",
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO supplier_contracts/i);
    expect(sql).toMatch(/RETURNING/i);
    expect(params).toContain(RELATIONSHIP_A1);
    expect(params).toContain("New Contract");
    expect(params).toContain("30 days net");
  });
});

describe("PostgresSupplierContractRepository.update", () => {
  it("builds dynamic SET clause for contractName change", async () => {
    const row = makeContractRow({ contract_name: "Updated Contract" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    await repo.update("contract-001", { contractName: "Updated Contract" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SET.*contract_name = \$1/i);
    expect(sql).toMatch(/WHERE id = \$\d+/i);
    expect(params[0]).toBe("Updated Contract");
  });

  it("returns null when contract does not exist", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    const result = await repo.update("ghost-id", { contractName: "Ghost" });
    expect(result).toBeNull();
  });
});

describe("PostgresSupplierContractRepository.expire and terminate", () => {
  it("sets status to expired", async () => {
    const row = makeContractRow({ status: "expired" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    const result = await repo.expire("contract-001");

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/status = 'expired'/i);
    expect(result?.status).toBe("expired");
  });

  it("sets status to terminated", async () => {
    const row = makeContractRow({ status: "terminated" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    const result = await repo.terminate("contract-001");

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/status = 'terminated'/i);
    expect(result?.status).toBe("terminated");
  });
});

describe("PostgresSupplierContractRepository.findActiveByRelationship", () => {
  it("queries with status = 'active' and relationship id", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    await repo.findActiveByRelationship(RELATIONSHIP_A1);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/status = 'active'/i);
    expect(params[0]).toBe(RELATIONSHIP_A1);
  });

  it("adds exclusion clause when excludeContractId is provided", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresSupplierContractRepository(pool);
    await repo.findActiveByRelationship(RELATIONSHIP_A1, "exclude-id");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/id != \$2/i);
    expect(params[1]).toBe("exclude-id");
  });
});

// ─── 3. SupplierContractService ───────────────────────────────────────────────

describe("SupplierContractService — RBAC enforcement", () => {
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("listByRelationship throws 403 when staff accesses wrong clinic relationship", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    // RELATIONSHIP_A1 belongs to CLINIC_A; staff is at CLINIC_B
    const wrongClinicStaff: AuthenticatedUser = {
      ...makeStaff(),
      homeClinicId: CLINIC_B,
    };
    await expect(
      service.listByRelationship(wrongClinicStaff, RELATIONSHIP_A1),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("clinical_staff can read contracts for own clinic", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.listByRelationship(makeStaff(), RELATIONSHIP_A1);
    expect(Array.isArray(result)).toBe(true);
  });

  it("create throws 403 for clinical_staff", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.create(makeStaff(), RELATIONSHIP_B1, {
        contractName: "Test",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        paymentTerms: "COD",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("expire throws 403 for clinical_staff", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.expire(makeStaff(), SEED_CONTRACT_DENTAL_DEPOT_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("terminate throws 403 for clinical_staff", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.terminate(makeStaff(), SEED_CONTRACT_DENTAL_DEPOT_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("owner_admin can access any clinic", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.listByRelationship(
      makeOwnerAdmin(),
      RELATIONSHIP_A1,
    );
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("SupplierContractService — date validation", () => {
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("throws 400 when end date equals start date", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const date = new Date("2026-01-01");
    await expect(
      service.create(admin, RELATIONSHIP_B1, {
        contractName: "Bad Dates",
        startDate: date,
        endDate: date,
        paymentTerms: "COD",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when end date is before start date", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.create(admin, RELATIONSHIP_B1, {
        contractName: "Bad Dates",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-01-01"),
        paymentTerms: "COD",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts valid date range", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.create(admin, RELATIONSHIP_B1, {
      contractName: "Valid Dates",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      paymentTerms: "COD",
    });
    expect(result.contractName).toBe("Valid Dates");
  });
});

describe("SupplierContractService — renewal notice days validation", () => {
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("throws 400 when renewal notice days is negative", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.create(admin, RELATIONSHIP_B1, {
        contractName: "Bad Renewal",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        paymentTerms: "COD",
        renewalNoticeDays: -1,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts renewal notice days of 0", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.create(admin, RELATIONSHIP_B1, {
      contractName: "Zero Notice",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      paymentTerms: "COD",
      renewalNoticeDays: 0,
    });
    expect(result.renewalNoticeDays).toBe(0);
  });

  it("accepts renewal notice days of 90", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.create(admin, RELATIONSHIP_B1, {
      contractName: "90 Day Notice",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      paymentTerms: "COD",
      renewalNoticeDays: 90,
    });
    expect(result.renewalNoticeDays).toBe(90);
  });
});

describe("SupplierContractService — monetary validation", () => {
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("throws 400 when minimumOrderValueCents is negative", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.create(admin, RELATIONSHIP_B1, {
        contractName: "Negative MOV",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        paymentTerms: "COD",
        minimumOrderValueCents: -1,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when estimatedAnnualCommitmentCents is negative", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.create(admin, RELATIONSHIP_B1, {
        contractName: "Negative Commitment",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        paymentTerms: "COD",
        estimatedAnnualCommitmentCents: -100,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when annualSpendTargetCents is negative", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.create(admin, RELATIONSHIP_B1, {
        contractName: "Negative Spend",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        paymentTerms: "COD",
        annualSpendTargetCents: -50,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts null for all monetary fields", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.create(admin, RELATIONSHIP_B1, {
      contractName: "No Amounts",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      paymentTerms: "COD",
      minimumOrderValueCents: null,
      estimatedAnnualCommitmentCents: null,
      annualSpendTargetCents: null,
    });
    expect(result.minimumOrderValueCents).toBeNull();
  });
});

describe("SupplierContractService — one active contract per relationship", () => {
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("throws 409 when a second active contract is created for same relationship", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.create(admin, RELATIONSHIP_A1, {
        contractName: "Duplicate Active",
        status: "active",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2027-06-01"),
        paymentTerms: "30 days net",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_ACTIVE_CONTRACT" });
  });

  it("allows creating a draft contract when an active one already exists", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.create(admin, RELATIONSHIP_A1, {
      contractName: "Draft Contract",
      status: "draft",
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-12-31"),
      paymentTerms: "30 days net",
    });
    expect(result.status).toBe("draft");
  });

  it("allows activating a contract after the existing active is expired", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await service.expire(admin, SEED_CONTRACT_DENTAL_DEPOT_ID);
    const result = await service.create(admin, RELATIONSHIP_A1, {
      contractName: "New Active",
      status: "active",
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-12-31"),
      paymentTerms: "30 days net",
    });
    expect(result.status).toBe("active");
  });
});

describe("SupplierContractService — expire and terminate", () => {
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("expires an active contract", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.expire(admin, SEED_CONTRACT_DENTAL_DEPOT_ID);
    expect(result.status).toBe("expired");
  });

  it("throws 409 when contract is already expired", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.expire(admin, SEED_CONTRACT_MEDIGATE_EXPIRED_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "SUPPLIER_CONTRACT_ALREADY_EXPIRED" });
  });

  it("terminates an active contract", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const result = await service.terminate(admin, SEED_CONTRACT_DENTAL_DEPOT_ID);
    expect(result.status).toBe("terminated");
  });

  it("throws 409 when contract is already terminated", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await service.terminate(admin, SEED_CONTRACT_DENTAL_DEPOT_ID);
    await expect(
      service.terminate(admin, SEED_CONTRACT_DENTAL_DEPOT_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: "SUPPLIER_CONTRACT_ALREADY_TERMINATED" });
  });

  it("throws 404 for unknown contract", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.expire(admin, "no-such-contract"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("SupplierContractService — getById", () => {
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("returns existing contract", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const contract = await service.getById(
      makeOwnerAdmin(),
      SEED_CONTRACT_DENTAL_DEPOT_ID,
    );
    expect(contract.id).toBe(SEED_CONTRACT_DENTAL_DEPOT_ID);
  });

  it("throws 404 for unknown id", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    await expect(
      service.getById(makeOwnerAdmin(), "no-such-contract"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 403 when caller does not belong to the contract's clinic", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const wrongClinic: AuthenticatedUser = {
      ...makeManager(CLINIC_B),
    };
    await expect(
      service.getById(wrongClinic, SEED_CONTRACT_DENTAL_DEPOT_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("SupplierContractService — relationship not found", () => {
  it("throws 404 when relationship does not exist", async () => {
    const contractRepo = createInMemorySupplierContractRepository();
    const relRepo = makeRelationshipRepo();
    const service = createSupplierContractService(contractRepo, relRepo);

    await expect(
      service.listByRelationship(makeOwnerAdmin(), "non-existent-rel-id"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── 4. SupplierContractController ───────────────────────────────────────────

describe("SupplierContractController", () => {
  const admin = makeOwnerAdmin();
  let contractRepo: SupplierContractRepository;
  let relRepo: SupplierRelationshipRepository;

  beforeEach(() => {
    contractRepo = createInMemorySupplierContractRepository();
    relRepo = makeRelationshipRepo();
  });

  it("listByRelationship — 200 with data array", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      relationshipId: RELATIONSHIP_A1,
    }) as unknown as import("express").Request;

    await handlers.listByRelationship(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getById — 200 for seed contract", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      id: SEED_CONTRACT_DENTAL_DEPOT_ID,
    }) as unknown as import("express").Request;

    await handlers.getById(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getById — propagates 404 from service", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res } = makeResponse();
    const req = makeRequest(admin, {
      id: "no-such-contract",
    }) as unknown as import("express").Request;

    await expect(handlers.getById(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("create — 201 with data on valid input", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { relationshipId: RELATIONSHIP_B1 },
      {
        contractName: "New Contract",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        paymentTerms: "COD",
      },
    ) as unknown as import("express").Request;

    await handlers.create(req, res);
    expect(status).toHaveBeenCalledWith(201);
  });

  it("create — 401 when user is absent", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res } = makeResponse();
    const req = {
      params: { relationshipId: RELATIONSHIP_B1 },
      body: {
        contractName: "Test",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        paymentTerms: "COD",
      },
    } as unknown as import("express").Request;

    await expect(handlers.create(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("expire — 200 on active contract", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      id: SEED_CONTRACT_DENTAL_DEPOT_ID,
    }) as unknown as import("express").Request;

    await handlers.expire(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("terminate — 200 on active contract", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      id: SEED_CONTRACT_DENTAL_DEPOT_ID,
    }) as unknown as import("express").Request;

    await handlers.terminate(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("update — 200 on valid patch", async () => {
    const service = createSupplierContractService(contractRepo, relRepo);
    const handlers = createSupplierContractHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { id: SEED_CONTRACT_DENTAL_DEPOT_ID },
      { contractName: "Amended Agreement" },
    ) as unknown as import("express").Request;

    await handlers.update(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });
});

// ─── 5. Seed idempotency ──────────────────────────────────────────────────────

describe("Seed idempotency — fixed IDs are stable across calls", () => {
  it("SEED_CONTRACT_DENTAL_DEPOT_ID is a non-empty string", () => {
    expect(SEED_CONTRACT_DENTAL_DEPOT_ID).toBeTruthy();
    expect(typeof SEED_CONTRACT_DENTAL_DEPOT_ID).toBe("string");
  });

  it("SEED_CONTRACT_MEDIGATE_EXPIRED_ID is a non-empty string", () => {
    expect(SEED_CONTRACT_MEDIGATE_EXPIRED_ID).toBeTruthy();
    expect(typeof SEED_CONTRACT_MEDIGATE_EXPIRED_ID).toBe("string");
  });

  it("seed IDs are distinct", () => {
    expect(SEED_CONTRACT_DENTAL_DEPOT_ID).not.toBe(
      SEED_CONTRACT_MEDIGATE_EXPIRED_ID,
    );
  });

  it("in-memory repository returns the same contract on repeated getById calls", async () => {
    const repo = createInMemorySupplierContractRepository();
    const first = await repo.getById(SEED_CONTRACT_DENTAL_DEPOT_ID);
    const second = await repo.getById(SEED_CONTRACT_DENTAL_DEPOT_ID);
    expect(first?.id).toBe(second?.id);
    expect(first?.contractName).toBe(second?.contractName);
  });

  it("creating a second in-memory repo produces independent seed data", async () => {
    const repo1 = createInMemorySupplierContractRepository();
    const repo2 = createInMemorySupplierContractRepository();
    await repo1.expire(SEED_CONTRACT_DENTAL_DEPOT_ID);
    const contract1 = await repo1.getById(SEED_CONTRACT_DENTAL_DEPOT_ID);
    const contract2 = await repo2.getById(SEED_CONTRACT_DENTAL_DEPOT_ID);
    expect(contract1?.status).toBe("expired");
    expect(contract2?.status).toBe("active");
  });
});
