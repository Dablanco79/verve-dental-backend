/**
 * legalEntityUnit.test.ts — Sprint 4B
 *
 * Unit tests for the Legal Entity layer:
 *   1. In-memory repository (CRUD, seed data, immutable behaviour)
 *   2. Postgres repository via mock pool (SQL shape, param wiring)
 *   3. LegalEntityService (RBAC enforcement, validation, 404 handling)
 *   4. LegalEntityController (HTTP response shapes, error propagation)
 *   5. Nullable clinic legal_entity_id does not break existing clinic tests
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { jest } from "@jest/globals";

import {
  createInMemoryLegalEntityRepository,
  SEED_LEGAL_ENTITY_ID,
} from "../legalEntityRepository.js";
import { createPostgresLegalEntityRepository } from "../legalEntityRepository.postgres.js";
import { createLegalEntityService } from "../../services/legalEntityService.js";
import { createLegalEntityHandlers } from "../../controllers/legalEntityController.js";
import type { LegalEntityRepository } from "../legalEntityRepository.js";
import type { DatabasePool } from "../../db/pool.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { AppError } from "../../types/errors.js";
import { createInMemoryClinicRepository } from "../clinicRepository.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEED_ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOwnerAdmin(): AuthenticatedUser {
  return {
    id: "user-admin-001",
    email: "admin@test.com",
    role: "owner_admin",
    homeClinicId: "clinic-001",
    homeClinicName: "Test Clinic",
    firstName: null,
    lastName: null,
    displayName: null,
    permissions: [],
  };
}

function makeNonAdmin(): AuthenticatedUser {
  return {
    id: "user-manager-001",
    email: "manager@test.com",
    role: "group_practice_manager",
    homeClinicId: "clinic-001",
    homeClinicName: "Test Clinic",
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
    id: "le-001",
    organisation_id: SEED_ORG_ID,
    legal_name: "Test Holdings Pty Ltd",
    trading_name: null,
    abn: null,
    tax_id: null,
    country_code: "AU",
    currency_code: "AUD",
    registered_address: null,
    status: "active",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ─── 1. In-Memory Repository ──────────────────────────────────────────────────

describe("InMemoryLegalEntityRepository", () => {
  it("is pre-seeded with the demo legal entity", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const entity = await repo.getById(SEED_LEGAL_ENTITY_ID);
    expect(entity).not.toBeNull();
    expect(entity?.legalName).toBe("Verve Demo Holdings Pty Ltd");
    expect(entity?.status).toBe("active");
    expect(entity?.organisationId).toBe(SEED_ORG_ID);
  });

  it("getById returns null for unknown id", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const result = await repo.getById("does-not-exist");
    expect(result).toBeNull();
  });

  it("listByOrganisation returns entities for the given org only", async () => {
    const repo = createInMemoryLegalEntityRepository();
    await repo.create(SEED_ORG_ID, { legalName: "Entity A" });
    await repo.create("other-org-id", { legalName: "Entity B" });
    const results = await repo.listByOrganisation(SEED_ORG_ID);
    expect(results.every((e) => e.organisationId === SEED_ORG_ID)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("listByOrganisation returns results ordered by legalName", async () => {
    const repo = createInMemoryLegalEntityRepository();
    await repo.create(SEED_ORG_ID, { legalName: "Zebra Holdings" });
    await repo.create(SEED_ORG_ID, { legalName: "Alpha Holdings" });
    const results = await repo.listByOrganisation(SEED_ORG_ID);
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      expect(prev?.legalName.localeCompare(curr?.legalName ?? "") ?? -1).toBeLessThanOrEqual(0);
    }
  });

  it("create persists a legal entity with auto-generated id", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const entity = await repo.create(SEED_ORG_ID, { legalName: "New Holdings Pty Ltd" });
    expect(entity.id).toBeTruthy();
    expect(entity.legalName).toBe("New Holdings Pty Ltd");
    expect(entity.status).toBe("active");
    expect(entity.countryCode).toBe("AU");
    expect(entity.currencyCode).toBe("AUD");

    const fetched = await repo.getById(entity.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(entity.id);
  });

  it("create uses caller-supplied id for deterministic seeding", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const fixedId = "fixed-le-0001";
    const entity = await repo.create(SEED_ORG_ID, {
      id: fixedId,
      legalName: "Fixed ID Entity",
    });
    expect(entity.id).toBe(fixedId);
  });

  it("create stores optional fields correctly", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const entity = await repo.create(SEED_ORG_ID, {
      legalName: "Full Entity Pty Ltd",
      tradingName: "Full Entity",
      abn: "12 345 678 901",
      taxId: "TAX-001",
      countryCode: "NZ",
      currencyCode: "NZD",
      registeredAddress: "1 Queen St, Auckland",
      status: "inactive",
    });
    expect(entity.tradingName).toBe("Full Entity");
    expect(entity.abn).toBe("12 345 678 901");
    expect(entity.taxId).toBe("TAX-001");
    expect(entity.countryCode).toBe("NZ");
    expect(entity.currencyCode).toBe("NZD");
    expect(entity.registeredAddress).toBe("1 Queen St, Auckland");
    expect(entity.status).toBe("inactive");
  });

  it("create defaults abn, tradingName, registeredAddress to null", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const entity = await repo.create(SEED_ORG_ID, { legalName: "Minimal" });
    expect(entity.abn).toBeNull();
    expect(entity.tradingName).toBeNull();
    expect(entity.registeredAddress).toBeNull();
  });

  it("update patches only the supplied fields", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const created = await repo.create(SEED_ORG_ID, {
      legalName: "Original Name Pty Ltd",
    });

    const updated = await repo.update(created.id, { legalName: "New Name Pty Ltd" });
    expect(updated?.legalName).toBe("New Name Pty Ltd");
    expect(updated?.status).toBe("active");
    expect(updated?.id).toBe(created.id);
    expect(updated?.organisationId).toBe(SEED_ORG_ID);
  });

  it("update returns null for non-existent id", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const result = await repo.update("ghost-id", { legalName: "Ghost" });
    expect(result).toBeNull();
  });

  it("update with no fields returns current record unchanged", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const created = await repo.create(SEED_ORG_ID, { legalName: "Stable Entity" });
    const updated = await repo.update(created.id, {});
    expect(updated?.legalName).toBe("Stable Entity");
  });

  it("update can deactivate an entity via status", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const created = await repo.create(SEED_ORG_ID, { legalName: "Active Entity" });
    const updated = await repo.update(created.id, { status: "inactive" });
    expect(updated?.status).toBe("inactive");
  });

  it("update can set abn to null (explicit null patch)", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const created = await repo.create(SEED_ORG_ID, {
      legalName: "ABN Entity",
      abn: "12 000 000 000",
    });
    const updated = await repo.update(created.id, { abn: null });
    expect(updated?.abn).toBeNull();
  });
});

// ─── 2. Postgres Repository (mock pool) ───────────────────────────────────────

describe("PostgresLegalEntityRepository.getById", () => {
  it("queries with the correct id param", async () => {
    const row = makeRow({ id: "le-001" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    const result = await repo.getById("le-001");

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1/i);
    expect(params[0]).toBe("le-001");
    expect(result?.id).toBe("le-001");
    expect(result?.legalName).toBe("Test Holdings Pty Ltd");
  });

  it("returns null when no rows found", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    const result = await repo.getById("not-found");
    expect(result).toBeNull();
  });

  it("maps snake_case row to camelCase domain object", async () => {
    const row = makeRow({
      trading_name: "Trading Co",
      abn: "12 345 678 901",
      tax_id: "TAX123",
      country_code: "NZ",
      currency_code: "NZD",
      registered_address: "1 Queen St",
    });
    const { pool } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    const result = await repo.getById("le-001");

    expect(result?.tradingName).toBe("Trading Co");
    expect(result?.abn).toBe("12 345 678 901");
    expect(result?.taxId).toBe("TAX123");
    expect(result?.countryCode).toBe("NZ");
    expect(result?.currencyCode).toBe("NZD");
    expect(result?.registeredAddress).toBe("1 Queen St");
    expect(result?.organisationId).toBe(SEED_ORG_ID);
  });
});

describe("PostgresLegalEntityRepository.listByOrganisation", () => {
  it("queries with organisation_id param and ORDER BY legal_name ASC", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    await repo.listByOrganisation(SEED_ORG_ID);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE organisation_id = \$1/i);
    expect(sql).toMatch(/ORDER BY legal_name ASC/i);
    expect(params[0]).toBe(SEED_ORG_ID);
  });
});

describe("PostgresLegalEntityRepository.create", () => {
  it("inserts with gen_random_uuid() when no id provided", async () => {
    const row = makeRow({ id: "db-generated-id" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    const result = await repo.create(SEED_ORG_ID, {
      legalName: "New Entity Pty Ltd",
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/gen_random_uuid\(\)/i);
    expect(params).toContain(SEED_ORG_ID);
    expect(params).toContain("New Entity Pty Ltd");
    expect(result.id).toBe("db-generated-id");
  });

  it("inserts with caller-supplied id when provided", async () => {
    const row = makeRow({ id: "fixed-id" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    await repo.create(SEED_ORG_ID, {
      id: "fixed-id",
      legalName: "Fixed Entity Pty Ltd",
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/\$1/);
    expect(params[0]).toBe("fixed-id");
  });

  it("defaults country_code to AU and currency_code to AUD", async () => {
    const row = makeRow();
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    await repo.create(SEED_ORG_ID, { legalName: "Defaults Entity" });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toContain("AU");
    expect(params).toContain("AUD");
  });
});

describe("PostgresLegalEntityRepository.update", () => {
  it("builds dynamic SET clause for legalName change", async () => {
    const row = makeRow({ legal_name: "Updated Name Pty Ltd" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    await repo.update("le-001", { legalName: "Updated Name Pty Ltd" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SET.*legal_name = \$1/i);
    expect(sql).toMatch(/WHERE id = \$\d+/i);
    expect(params[0]).toBe("Updated Name Pty Ltd");
  });

  it("returns null when the entity does not exist", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    const result = await repo.update("ghost-id", { legalName: "Ghost" });
    expect(result).toBeNull();
  });

  it("includes abn in SET when provided", async () => {
    const row = makeRow({ abn: "12 000 000 000" });
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresLegalEntityRepository(pool);
    await repo.update("le-001", { abn: "12 000 000 000" });

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/abn = \$/i);
  });
});

// ─── 3. LegalEntityService ────────────────────────────────────────────────────

describe("LegalEntityService — RBAC enforcement", () => {
  let repo: LegalEntityRepository;

  beforeEach(() => {
    repo = createInMemoryLegalEntityRepository();
  });

  it("listByOrganisation throws 403 for non-admin", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.listByOrganisation(makeNonAdmin(), SEED_ORG_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("getLegalEntity throws 403 for non-admin", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.getLegalEntity(makeNonAdmin(), SEED_LEGAL_ENTITY_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("createLegalEntity throws 403 for non-admin", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.createLegalEntity(makeNonAdmin(), SEED_ORG_ID, {
        legalName: "Test",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("updateLegalEntity throws 403 for non-admin", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.updateLegalEntity(makeNonAdmin(), SEED_LEGAL_ENTITY_ID, {
        legalName: "New",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("LegalEntityService — validation", () => {
  let repo: LegalEntityRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryLegalEntityRepository();
  });

  it("createLegalEntity throws 400 when legalName is missing", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.createLegalEntity(admin, SEED_ORG_ID, { legalName: "" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("createLegalEntity throws 400 when countryCode is not 2 chars", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.createLegalEntity(admin, SEED_ORG_ID, {
        legalName: "Test Pty Ltd",
        countryCode: "AUS",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("createLegalEntity throws 400 when currencyCode is not 3 chars", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.createLegalEntity(admin, SEED_ORG_ID, {
        legalName: "Test Pty Ltd",
        currencyCode: "AU",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("createLegalEntity accepts null abn without error", async () => {
    const service = createLegalEntityService(repo);
    const entity = await service.createLegalEntity(admin, SEED_ORG_ID, {
      legalName: "No ABN Pty Ltd",
      abn: null,
    });
    expect(entity.abn).toBeNull();
  });

  it("updateLegalEntity throws 400 when legalName is empty string", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.updateLegalEntity(admin, SEED_LEGAL_ENTITY_ID, { legalName: "" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("updateLegalEntity throws 400 when countryCode is not 2 chars", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.updateLegalEntity(admin, SEED_LEGAL_ENTITY_ID, {
        countryCode: "AUS",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("LegalEntityService — owner_admin operations", () => {
  let repo: LegalEntityRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryLegalEntityRepository();
  });

  it("listByOrganisation returns entities for the organisation", async () => {
    const service = createLegalEntityService(repo);
    const result = await service.listByOrganisation(admin, SEED_ORG_ID);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("getLegalEntity returns existing entity", async () => {
    const service = createLegalEntityService(repo);
    const entity = await service.getLegalEntity(admin, SEED_LEGAL_ENTITY_ID);
    expect(entity.id).toBe(SEED_LEGAL_ENTITY_ID);
  });

  it("getLegalEntity throws 404 for unknown id", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.getLegalEntity(admin, "unknown-id"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("createLegalEntity creates and returns the new entity", async () => {
    const service = createLegalEntityService(repo);
    const entity = await service.createLegalEntity(admin, SEED_ORG_ID, {
      legalName: "Created Entity Pty Ltd",
    });
    expect(entity.legalName).toBe("Created Entity Pty Ltd");
    expect(entity.status).toBe("active");
    expect(entity.id).toBeTruthy();
    expect(entity.organisationId).toBe(SEED_ORG_ID);
  });

  it("updateLegalEntity updates legalName and returns updated entity", async () => {
    const service = createLegalEntityService(repo);
    const created = await service.createLegalEntity(admin, SEED_ORG_ID, {
      legalName: "Old Legal Name",
    });
    const updated = await service.updateLegalEntity(admin, created.id, {
      legalName: "New Legal Name",
    });
    expect(updated.legalName).toBe("New Legal Name");
    expect(updated.id).toBe(created.id);
  });

  it("updateLegalEntity throws 404 for unknown id", async () => {
    const service = createLegalEntityService(repo);
    await expect(
      service.updateLegalEntity(admin, "ghost-id", { legalName: "Ghost" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("updateLegalEntity can deactivate an entity", async () => {
    const service = createLegalEntityService(repo);
    const created = await service.createLegalEntity(admin, SEED_ORG_ID, {
      legalName: "Active Entity Pty Ltd",
    });
    const updated = await service.updateLegalEntity(admin, created.id, {
      status: "inactive",
    });
    expect(updated.status).toBe("inactive");
  });
});

// ─── 4. LegalEntityController ─────────────────────────────────────────────────

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

describe("LegalEntityController", () => {
  const admin = makeOwnerAdmin();
  let repo: LegalEntityRepository;

  beforeEach(() => {
    repo = createInMemoryLegalEntityRepository();
  });

  it("listByOrganisation — 200 with data array", async () => {
    const service = createLegalEntityService(repo);
    const handlers = createLegalEntityHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      organisationId: SEED_ORG_ID,
    }) as unknown as import("express").Request;

    await handlers.listByOrganisation(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getLegalEntity — 200 with data object for seed entity", async () => {
    const service = createLegalEntityService(repo);
    const handlers = createLegalEntityHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin, {
      id: SEED_LEGAL_ENTITY_ID,
    }) as unknown as import("express").Request;

    await handlers.getLegalEntity(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("getLegalEntity — propagates 404 from service", async () => {
    const service = createLegalEntityService(repo);
    const handlers = createLegalEntityHandlers(service);
    const { res } = makeResponse();
    const req = makeRequest(admin, {
      id: "no-such-entity",
    }) as unknown as import("express").Request;

    await expect(handlers.getLegalEntity(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("createLegalEntity — 201 with data on valid input", async () => {
    const service = createLegalEntityService(repo);
    const handlers = createLegalEntityHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { organisationId: SEED_ORG_ID },
      { legalName: "Brand New Pty Ltd" },
    ) as unknown as import("express").Request;

    await handlers.createLegalEntity(req, res);
    expect(status).toHaveBeenCalledWith(201);
  });

  it("createLegalEntity — 401 when user is absent", async () => {
    const service = createLegalEntityService(repo);
    const handlers = createLegalEntityHandlers(service);
    const { res } = makeResponse();
    const req = {
      params: { organisationId: SEED_ORG_ID },
      body: { legalName: "Test" },
    } as unknown as import("express").Request;

    await expect(handlers.createLegalEntity(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("updateLegalEntity — 200 on valid patch", async () => {
    const service = createLegalEntityService(repo);
    const handlers = createLegalEntityHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { id: SEED_LEGAL_ENTITY_ID },
      { legalName: "Patched Name Pty Ltd" },
    ) as unknown as import("express").Request;

    await handlers.updateLegalEntity(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });
});

// ─── 5. Clinic backward-compatibility — nullable legal_entity_id ──────────────

describe("Clinic backward-compatibility — nullable legal_entity_id", () => {
  it("in-memory clinic repository still works without legal_entity_id", async () => {
    const clinicRepo = createInMemoryClinicRepository();
    const clinics = await clinicRepo.findAll();
    expect(Array.isArray(clinics)).toBe(true);

    if (clinics.length > 0) {
      const clinic = clinics[0];
      expect(clinic).toBeDefined();
    }
  });

  it("legal entities list is empty for an unknown organisation", async () => {
    const repo = createInMemoryLegalEntityRepository();
    const result = await repo.listByOrganisation("unknown-org-id");
    expect(result).toEqual([]);
  });
});
