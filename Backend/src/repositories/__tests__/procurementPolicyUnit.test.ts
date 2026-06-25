/**
 * procurementPolicyUnit.test.ts — Sprint 4E
 *
 * Unit tests for the Procurement Policy layer:
 *   1. In-memory repository (CRUD, seed data, immutable behaviour)
 *   2. Postgres repository via mock pool (SQL shape, param wiring)
 *   3. ProcurementPolicyService (RBAC, validation rules, 404 handling)
 *   4. ProcurementPolicyController (HTTP response shapes, error propagation)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { jest } from "@jest/globals";

import {
  createInMemoryProcurementPolicyRepository,
  SEED_POLICY_IDS,
} from "../procurementPolicyRepository.js";
import { createPostgresProcurementPolicyRepository } from "../procurementPolicyRepository.postgres.js";
import { createProcurementPolicyService } from "../../services/procurementPolicyService.js";
import { createProcurementPolicyHandlers } from "../../controllers/procurementPolicyController.js";
import type { ProcurementPolicyRepository } from "../procurementPolicyRepository.js";
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
import { SEED_MASTER_CATALOG_IDS } from "../seed/inventorySeed.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLINIC_A = SEED_CLINIC_A_ID;
const CLINIC_B = SEED_CLINIC_B_ID;
const RELATIONSHIP_A1 = SEED_RELATIONSHIP_A1_ID;
const RELATIONSHIP_B1 = SEED_RELATIONSHIP_B1_ID;
const PRODUCT_GLOVES = SEED_MASTER_CATALOG_IDS.nitrileGloves;

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

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-001",
    clinic_id: CLINIC_A,
    supplier_relationship_id: RELATIONSHIP_A1,
    master_catalog_item_id: PRODUCT_GLOVES,
    policy_name: "Test Policy",
    policy_status: "active",
    priority: 1,
    preferred_supplier: true,
    allow_fallback: false,
    fallback_priority: null,
    minimum_order_quantity: null,
    preferred_order_day: null,
    preferred_delivery_day: null,
    price_difference_threshold_percent: null,
    approval_required: false,
    reorder_strategy: "standard",
    notes: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
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

describe("InMemoryProcurementPolicyRepository — seed data", () => {
  it("is pre-seeded with 3 demo policies", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policies = await repo.listByClinic(CLINIC_A);
    expect(policies.length).toBeGreaterThanOrEqual(3);
  });

  it("listByClinic returns policies ordered by priority ASC", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policies = await repo.listByClinic(CLINIC_A, { status: "active" });
    for (let i = 1; i < policies.length; i++) {
      const prev = policies[i - 1];
      const curr = policies[i];
      expect((prev?.priority ?? 0) <= (curr?.priority ?? 0)).toBe(true);
    }
  });

  it("getById returns the seed preferred gloves policy", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policy = await repo.getById(SEED_POLICY_IDS.clinicAGlovesPreferred);
    expect(policy).not.toBeNull();
    expect(policy?.preferredSupplier).toBe(true);
    expect(policy?.priority).toBe(1);
    expect(policy?.masterCatalogItemId).toBe(PRODUCT_GLOVES);
  });

  it("getById returns null for unknown id", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const result = await repo.getById("does-not-exist");
    expect(result).toBeNull();
  });

  it("general policy has masterCatalogItemId = null", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policy = await repo.getById(SEED_POLICY_IDS.clinicAGeneralPreferred);
    expect(policy?.masterCatalogItemId).toBeNull();
  });
});

describe("InMemoryProcurementPolicyRepository — create", () => {
  it("creates a policy with auto-generated id", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policy = await repo.create(CLINIC_A, {
      supplierRelationshipId: RELATIONSHIP_A1,
      masterCatalogItemId: null,
      policyName: "New Policy",
      priority: 5,
    });
    expect(policy.id).toBeTruthy();
    expect(policy.policyName).toBe("New Policy");
    expect(policy.policyStatus).toBe("active");
    expect(policy.reorderStrategy).toBe("standard");
    expect(policy.approvalRequired).toBe(false);
    expect(policy.preferredSupplier).toBe(false);
  });

  it("create defaults optional fields to null / false", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policy = await repo.create(CLINIC_A, {
      supplierRelationshipId: RELATIONSHIP_A1,
      policyName: "Minimal",
      priority: 10,
    });
    expect(policy.masterCatalogItemId).toBeNull();
    expect(policy.fallbackPriority).toBeNull();
    expect(policy.minimumOrderQuantity).toBeNull();
    expect(policy.preferredOrderDay).toBeNull();
    expect(policy.preferredDeliveryDay).toBeNull();
    expect(policy.priceDifferenceThresholdPercent).toBeNull();
    expect(policy.notes).toBeNull();
  });
});

describe("InMemoryProcurementPolicyRepository — update", () => {
  it("patches only the supplied fields", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policy = await repo.update(SEED_POLICY_IDS.clinicAGlovesFallback, {
      policyName: "Updated Fallback",
      approvalRequired: false,
    });
    expect(policy?.policyName).toBe("Updated Fallback");
    expect(policy?.approvalRequired).toBe(false);
    expect(policy?.priority).toBe(2);
  });

  it("update returns null for non-existent id", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const result = await repo.update("ghost-id", { policyName: "Ghost" });
    expect(result).toBeNull();
  });

  it("update with no fields returns current record unchanged", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policy = await repo.update(
      SEED_POLICY_IDS.clinicAGlovesPreferred,
      {},
    );
    expect(policy?.policyStatus).toBe("active");
    expect(policy?.policyName).toBe("Nitrile Gloves — Preferred Supplier");
  });
});

describe("InMemoryProcurementPolicyRepository — deactivate", () => {
  it("sets policyStatus to inactive", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const policy = await repo.deactivate(SEED_POLICY_IDS.clinicAGlovesPreferred);
    expect(policy?.policyStatus).toBe("inactive");
  });

  it("deactivate returns null for non-existent id", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const result = await repo.deactivate("ghost-id");
    expect(result).toBeNull();
  });
});

describe("InMemoryProcurementPolicyRepository — findActivePreferred", () => {
  it("returns the preferred policy for a product", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const result = await repo.findActivePreferred(CLINIC_A, PRODUCT_GLOVES);
    expect(result).not.toBeNull();
    expect(result?.preferredSupplier).toBe(true);
  });

  it("returns null when excluded policy id matches the only preferred", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const result = await repo.findActivePreferred(
      CLINIC_A,
      PRODUCT_GLOVES,
      SEED_POLICY_IDS.clinicAGlovesPreferred,
    );
    expect(result).toBeNull();
  });

  it("returns null for a clinic with no preferred policy for a product", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const result = await repo.findActivePreferred(
      CLINIC_B,
      PRODUCT_GLOVES,
    );
    expect(result).toBeNull();
  });
});

describe("InMemoryProcurementPolicyRepository — findActiveByPriority", () => {
  it("returns policies with matching priority", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const results = await repo.findActiveByPriority(
      CLINIC_A,
      PRODUCT_GLOVES,
      1,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.priority === 1)).toBe(true);
  });

  it("excludes policy with specified id", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const results = await repo.findActiveByPriority(
      CLINIC_A,
      PRODUCT_GLOVES,
      1,
      SEED_POLICY_IDS.clinicAGlovesPreferred,
    );
    expect(results.find((p) => p.id === SEED_POLICY_IDS.clinicAGlovesPreferred)).toBeUndefined();
  });
});

// ─── 2. Postgres Repository (mock pool) ──────────────────────────────────────

describe("PostgresProcurementPolicyRepository.getById", () => {
  it("queries with the correct id param", async () => {
    const row = makeRow({ id: "policy-001" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    const result = await repo.getById("policy-001");

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1/i);
    expect(params[0]).toBe("policy-001");
    expect(result?.id).toBe("policy-001");
    expect(result?.policyName).toBe("Test Policy");
  });

  it("returns null when no rows found", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    const result = await repo.getById("not-found");
    expect(result).toBeNull();
  });

  it("maps snake_case row to camelCase domain object", async () => {
    const row = makeRow({
      price_difference_threshold_percent: "5.00",
      preferred_order_day: "monday",
      preferred_delivery_day: "thursday",
      fallback_priority: 2,
      minimum_order_quantity: 5,
      notes: "Test note",
    });
    const { pool } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    const result = await repo.getById("policy-001");

    expect(result?.priceDifferenceThresholdPercent).toBe(5);
    expect(result?.preferredOrderDay).toBe("monday");
    expect(result?.preferredDeliveryDay).toBe("thursday");
    expect(result?.fallbackPriority).toBe(2);
    expect(result?.minimumOrderQuantity).toBe(5);
    expect(result?.notes).toBe("Test note");
    expect(result?.clinicId).toBe(CLINIC_A);
    expect(result?.supplierRelationshipId).toBe(RELATIONSHIP_A1);
  });
});

describe("PostgresProcurementPolicyRepository.listByClinic", () => {
  it("queries with clinic_id and ORDER BY priority ASC", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    await repo.listByClinic(CLINIC_A);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE clinic_id = \$1/i);
    expect(sql).toMatch(/ORDER BY priority ASC/i);
    expect(params[0]).toBe(CLINIC_A);
  });

  it("adds status filter when provided", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    await repo.listByClinic(CLINIC_A, { status: "active" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/policy_status = \$2/i);
    expect(params[1]).toBe("active");
  });
});

describe("PostgresProcurementPolicyRepository.create", () => {
  it("inserts all required columns", async () => {
    const row = makeRow({ id: "new-policy-id" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);

    await repo.create(CLINIC_A, {
      supplierRelationshipId: RELATIONSHIP_A1,
      policyName: "New Policy",
      priority: 3,
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO procurement_policies/i);
    expect(sql).toMatch(/RETURNING/i);
    expect(params).toContain(CLINIC_A);
    expect(params).toContain(RELATIONSHIP_A1);
    expect(params).toContain("New Policy");
    expect(params).toContain(3);
  });
});

describe("PostgresProcurementPolicyRepository.update", () => {
  it("builds dynamic SET clause for policyName change", async () => {
    const row = makeRow({ policy_name: "Updated Policy" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    await repo.update("policy-001", { policyName: "Updated Policy" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SET.*policy_name = \$1/i);
    expect(sql).toMatch(/WHERE id = \$\d+/i);
    expect(params[0]).toBe("Updated Policy");
  });

  it("returns null when policy does not exist", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    const result = await repo.update("ghost-id", { policyName: "Ghost" });
    expect(result).toBeNull();
  });

  it("includes priority in SET when provided", async () => {
    const row = makeRow({ priority: 5 });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    await repo.update("policy-001", { priority: 5 });

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/priority = \$/i);
  });
});

describe("PostgresProcurementPolicyRepository.deactivate", () => {
  it("sets policy_status to inactive", async () => {
    const row = makeRow({ policy_status: "inactive" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    const result = await repo.deactivate("policy-001");

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/policy_status = 'inactive'/i);
    expect(result?.policyStatus).toBe("inactive");
  });
});

describe("PostgresProcurementPolicyRepository.findActivePreferred", () => {
  it("queries with preferred_supplier = true and active status for a product", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    await repo.findActivePreferred(CLINIC_A, PRODUCT_GLOVES);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/preferred_supplier = true/i);
    expect(sql).toMatch(/policy_status = 'active'/i);
    expect(params[0]).toBe(CLINIC_A);
    expect(params[1]).toBe(PRODUCT_GLOVES);
  });

  it("uses IS NULL for general policies", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresProcurementPolicyRepository(pool);
    await repo.findActivePreferred(CLINIC_A, null);

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/master_catalog_item_id IS NULL/i);
  });
});

// ─── 3. ProcurementPolicyService ─────────────────────────────────────────────

describe("ProcurementPolicyService — RBAC enforcement", () => {
  let repo: ProcurementPolicyRepository;

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("listByClinic throws 403 when staff accesses wrong clinic", async () => {
    const service = createProcurementPolicyService(repo);
    const wrongClinicUser: AuthenticatedUser = {
      ...makeStaff(),
      homeClinicId: CLINIC_B,
    };
    await expect(
      service.listByClinic(wrongClinicUser, CLINIC_A),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("clinical_staff can read own clinic policies", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.listByClinic(makeStaff(), CLINIC_A);
    expect(Array.isArray(result)).toBe(true);
  });

  it("create throws 403 for clinical_staff", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(makeStaff(), CLINIC_A, {
        supplierRelationshipId: RELATIONSHIP_B1,
        policyName: "Test",
        priority: 10,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("deactivate throws 403 for clinical_staff", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.deactivate(makeStaff(), SEED_POLICY_IDS.clinicAGlovesPreferred),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("owner_admin can access any clinic", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.listByClinic(makeOwnerAdmin(), CLINIC_B);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("ProcurementPolicyService — priority validation", () => {
  let repo: ProcurementPolicyRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("throws 400 when priority < 1", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_A, {
        supplierRelationshipId: RELATIONSHIP_B1,
        policyName: "Bad Priority",
        priority: 0,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when priority is not an integer", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_A, {
        supplierRelationshipId: RELATIONSHIP_B1,
        policyName: "Float Priority",
        priority: 1.5,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts priority = 1", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.create(admin, CLINIC_B, {
      supplierRelationshipId: RELATIONSHIP_B1,
      policyName: "Valid Priority",
      priority: 1,
    });
    expect(result.priority).toBe(1);
  });
});

describe("ProcurementPolicyService — fallback priority validation", () => {
  let repo: ProcurementPolicyRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("throws 400 when fallback_priority <= priority", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_B, {
        supplierRelationshipId: RELATIONSHIP_B1,
        policyName: "Bad Fallback",
        priority: 3,
        fallbackPriority: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when fallback_priority equals priority", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_B, {
        supplierRelationshipId: RELATIONSHIP_B1,
        policyName: "Equal Fallback",
        priority: 3,
        fallbackPriority: 3,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts fallback_priority > priority", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.create(admin, CLINIC_B, {
      supplierRelationshipId: RELATIONSHIP_B1,
      policyName: "Valid Fallback",
      priority: 3,
      fallbackPriority: 5,
    });
    expect(result.fallbackPriority).toBe(5);
  });

  it("accepts null fallback_priority", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.create(admin, CLINIC_B, {
      supplierRelationshipId: RELATIONSHIP_B1,
      policyName: "No Fallback",
      priority: 3,
      fallbackPriority: null,
    });
    expect(result.fallbackPriority).toBeNull();
  });
});

describe("ProcurementPolicyService — threshold validation", () => {
  let repo: ProcurementPolicyRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("throws 400 when threshold > 100", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_B, {
        supplierRelationshipId: RELATIONSHIP_B1,
        policyName: "Over Threshold",
        priority: 5,
        priceDifferenceThresholdPercent: 101,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when threshold < 0", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_B, {
        supplierRelationshipId: RELATIONSHIP_B1,
        policyName: "Negative Threshold",
        priority: 5,
        priceDifferenceThresholdPercent: -1,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts threshold of 0", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.create(admin, CLINIC_B, {
      supplierRelationshipId: RELATIONSHIP_B1,
      policyName: "Zero Threshold",
      priority: 5,
      priceDifferenceThresholdPercent: 0,
    });
    expect(result.priceDifferenceThresholdPercent).toBe(0);
  });

  it("accepts threshold of 100", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.create(admin, CLINIC_B, {
      supplierRelationshipId: RELATIONSHIP_B1,
      policyName: "Max Threshold",
      priority: 5,
      priceDifferenceThresholdPercent: 100,
    });
    expect(result.priceDifferenceThresholdPercent).toBe(100);
  });
});

describe("ProcurementPolicyService — preferred supplier uniqueness", () => {
  let repo: ProcurementPolicyRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("throws 409 when a second preferred policy is created for same clinic/product", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_A, {
        supplierRelationshipId: RELATIONSHIP_B1,
        masterCatalogItemId: PRODUCT_GLOVES,
        policyName: "Duplicate Preferred",
        priority: 5,
        preferredSupplier: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_PREFERRED_SUPPLIER" });
  });

  it("allows a preferred policy for a different product", async () => {
    const service = createProcurementPolicyService(repo);
    const anotherProduct = "d2222222-2222-4222-8222-222222222222";
    const result = await service.create(admin, CLINIC_A, {
      supplierRelationshipId: RELATIONSHIP_A1,
      masterCatalogItemId: anotherProduct,
      policyName: "Another Product Preferred",
      priority: 1,
      preferredSupplier: true,
    });
    expect(result.preferredSupplier).toBe(true);
  });

  it("allows creating a non-preferred policy when a preferred already exists", async () => {
    const service = createProcurementPolicyService(repo);
    const result = await service.create(admin, CLINIC_A, {
      supplierRelationshipId: RELATIONSHIP_B1,
      masterCatalogItemId: PRODUCT_GLOVES,
      policyName: "Non-preferred",
      priority: 5,
      preferredSupplier: false,
    });
    expect(result.preferredSupplier).toBe(false);
  });
});

describe("ProcurementPolicyService — duplicate priority prevention", () => {
  let repo: ProcurementPolicyRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("throws 409 when two active policies share the same priority for clinic/product", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.create(admin, CLINIC_A, {
        supplierRelationshipId: RELATIONSHIP_B1,
        masterCatalogItemId: PRODUCT_GLOVES,
        policyName: "Duplicate Priority",
        priority: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_POLICY_PRIORITY" });
  });

  it("allows same priority for different products", async () => {
    const service = createProcurementPolicyService(repo);
    const anotherProduct = "d3333333-3333-4333-8333-333333333333";
    const result = await service.create(admin, CLINIC_A, {
      supplierRelationshipId: RELATIONSHIP_A1,
      masterCatalogItemId: anotherProduct,
      policyName: "Same Priority Diff Product",
      priority: 1,
    });
    expect(result.priority).toBe(1);
  });
});

describe("ProcurementPolicyService — getById", () => {
  let repo: ProcurementPolicyRepository;

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("returns existing policy", async () => {
    const service = createProcurementPolicyService(repo);
    const policy = await service.getById(
      makeOwnerAdmin(),
      SEED_POLICY_IDS.clinicAGlovesPreferred,
    );
    expect(policy.id).toBe(SEED_POLICY_IDS.clinicAGlovesPreferred);
  });

  it("throws 404 for unknown id", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.getById(makeOwnerAdmin(), "no-such-policy"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 403 when caller does not belong to the policy's clinic", async () => {
    const service = createProcurementPolicyService(repo);
    const wrongClinic: AuthenticatedUser = {
      ...makeManager(CLINIC_B),
    };
    await expect(
      service.getById(wrongClinic, SEED_POLICY_IDS.clinicAGlovesPreferred),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("ProcurementPolicyService — deactivate", () => {
  let repo: ProcurementPolicyRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("deactivates an active policy", async () => {
    const service = createProcurementPolicyService(repo);
    const policy = await service.deactivate(
      admin,
      SEED_POLICY_IDS.clinicAGlovesPreferred,
    );
    expect(policy.policyStatus).toBe("inactive");
  });

  it("throws 409 when policy is already inactive", async () => {
    const service = createProcurementPolicyService(repo);
    await service.deactivate(admin, SEED_POLICY_IDS.clinicAGlovesPreferred);
    await expect(
      service.deactivate(admin, SEED_POLICY_IDS.clinicAGlovesPreferred),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "PROCUREMENT_POLICY_ALREADY_INACTIVE",
    });
  });

  it("throws 404 for unknown id", async () => {
    const service = createProcurementPolicyService(repo);
    await expect(
      service.deactivate(admin, "ghost-policy"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── 4. ProcurementPolicyController ──────────────────────────────────────────

describe("ProcurementPolicyController", () => {
  const admin = makeOwnerAdmin();
  let repo: ProcurementPolicyRepository;

  beforeEach(() => {
    repo = createInMemoryProcurementPolicyRepository();
  });

  it("listByClinic — 200 with data array", async () => {
    const service = createProcurementPolicyService(repo);
    const handlers = createProcurementPolicyHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, { clinicId: CLINIC_A }) as unknown as import("express").Request;

    await handlers.listByClinic(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getById — 200 for seed policy", async () => {
    const service = createProcurementPolicyService(repo);
    const handlers = createProcurementPolicyHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      id: SEED_POLICY_IDS.clinicAGlovesPreferred,
    }) as unknown as import("express").Request;

    await handlers.getById(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getById — propagates 404 from service", async () => {
    const service = createProcurementPolicyService(repo);
    const handlers = createProcurementPolicyHandlers(service);
    const { res } = makeResponse();
    const req = makeRequest(admin, {
      id: "no-such-policy",
    }) as unknown as import("express").Request;

    await expect(handlers.getById(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("create — 201 with data on valid input", async () => {
    const service = createProcurementPolicyService(repo);
    const handlers = createProcurementPolicyHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { clinicId: CLINIC_B },
      {
        supplierRelationshipId: RELATIONSHIP_A1,
        policyName: "New Policy",
        priority: 1,
      },
    ) as unknown as import("express").Request;

    await handlers.create(req, res);
    expect(status).toHaveBeenCalledWith(201);
  });

  it("create — 401 when user is absent", async () => {
    const service = createProcurementPolicyService(repo);
    const handlers = createProcurementPolicyHandlers(service);
    const { res } = makeResponse();
    const req = {
      params: { clinicId: CLINIC_A },
      body: { supplierRelationshipId: RELATIONSHIP_A1, policyName: "Test", priority: 10 },
    } as unknown as import("express").Request;

    await expect(handlers.create(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("deactivate — 200 on active policy", async () => {
    const service = createProcurementPolicyService(repo);
    const handlers = createProcurementPolicyHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      id: SEED_POLICY_IDS.clinicAGlovesPreferred,
    }) as unknown as import("express").Request;

    await handlers.deactivate(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("update — 200 on valid patch", async () => {
    const service = createProcurementPolicyService(repo);
    const handlers = createProcurementPolicyHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { id: SEED_POLICY_IDS.clinicAGlovesPreferred },
      { policyName: "Updated Name" },
    ) as unknown as import("express").Request;

    await handlers.update(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });
});

// ─── 5. Seed idempotency ──────────────────────────────────────────────────────

describe("Seed idempotency — fixed IDs are stable across calls", () => {
  it("SEED_POLICY_IDS are non-empty strings", () => {
    expect(SEED_POLICY_IDS.clinicAGlovesPreferred).toBeTruthy();
    expect(SEED_POLICY_IDS.clinicAGlovesFallback).toBeTruthy();
    expect(SEED_POLICY_IDS.clinicAGeneralPreferred).toBeTruthy();
  });

  it("seed policies have distinct IDs", () => {
    const ids = Object.values(SEED_POLICY_IDS);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("in-memory repository returns the same policy on repeated getById calls", async () => {
    const repo = createInMemoryProcurementPolicyRepository();
    const first = await repo.getById(SEED_POLICY_IDS.clinicAGlovesPreferred);
    const second = await repo.getById(SEED_POLICY_IDS.clinicAGlovesPreferred);
    expect(first?.id).toBe(second?.id);
    expect(first?.priority).toBe(second?.priority);
  });
});
