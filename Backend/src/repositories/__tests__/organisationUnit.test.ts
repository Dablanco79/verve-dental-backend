/**
 * organisationUnit.test.ts — Sprint 4A
 *
 * Unit tests for the Organisation layer:
 *   1. In-memory repository (CRUD, seed data, immutable behaviour)
 *   2. Postgres repository via mock pool (SQL shape, param wiring)
 *   3. OrganisationService (RBAC enforcement, 404 handling, delegation)
 *   4. OrganisationController (HTTP response shapes, error propagation)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { jest } from "@jest/globals";

import {
  createInMemoryOrganisationRepository,
  SEED_ORGANISATION_ID,
} from "../organisationRepository.js";
import { createPostgresOrganisationRepository } from "../organisationRepository.postgres.js";
import { createOrganisationService } from "../../services/organisationService.js";
import { createOrganisationHandlers } from "../../controllers/organisationController.js";
import type { OrganisationRepository } from "../organisationRepository.js";
import type { DatabasePool } from "../../db/pool.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { AppError } from "../../types/errors.js";

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

// ─── 1. In-Memory Repository ──────────────────────────────────────────────────

describe("InMemoryOrganisationRepository", () => {
  it("is pre-seeded with the demo organisation", async () => {
    const repo = createInMemoryOrganisationRepository();
    const org = await repo.findById(SEED_ORGANISATION_ID);
    expect(org).not.toBeNull();
    expect(org?.name).toBe("Verve Demo Organisation");
    expect(org?.status).toBe("active");
  });

  it("findById returns null for unknown id", async () => {
    const repo = createInMemoryOrganisationRepository();
    const result = await repo.findById("does-not-exist");
    expect(result).toBeNull();
  });

  it("findAll returns all organisations ordered by name", async () => {
    const repo = createInMemoryOrganisationRepository();
    await repo.create({ name: "Zebra Group" });
    await repo.create({ name: "Alpha Group" });
    const all = await repo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1];
      const curr = all[i];
      expect(prev?.name.localeCompare(curr?.name ?? "") ?? -1).toBeLessThanOrEqual(0);
    }
  });

  it("create persists an organisation with auto-generated id when none supplied", async () => {
    const repo = createInMemoryOrganisationRepository();
    const org = await repo.create({ name: "New Group" });
    expect(org.id).toBeTruthy();
    expect(org.name).toBe("New Group");
    expect(org.status).toBe("active");

    const fetched = await repo.findById(org.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(org.id);
  });

  it("create uses caller-supplied id for deterministic seeding", async () => {
    const repo = createInMemoryOrganisationRepository();
    const fixedId = "fixed-id-0001";
    const org = await repo.create({ id: fixedId, name: "Fixed ID Org" });
    expect(org.id).toBe(fixedId);
  });

  it("create honours supplied status", async () => {
    const repo = createInMemoryOrganisationRepository();
    const org = await repo.create({ name: "Inactive Org", status: "inactive" });
    expect(org.status).toBe("inactive");
  });

  it("update patches only the supplied fields", async () => {
    const repo = createInMemoryOrganisationRepository();
    const created = await repo.create({ name: "Original Name" });

    const updated = await repo.update(created.id, { name: "New Name" });
    expect(updated?.name).toBe("New Name");
    expect(updated?.status).toBe("active");
    expect(updated?.id).toBe(created.id);
  });

  it("update returns null for non-existent id", async () => {
    const repo = createInMemoryOrganisationRepository();
    const result = await repo.update("ghost-id", { name: "Ghost" });
    expect(result).toBeNull();
  });

  it("update with no fields returns current record unchanged", async () => {
    const repo = createInMemoryOrganisationRepository();
    const created = await repo.create({ name: "Stable Org" });
    const updated = await repo.update(created.id, {});
    expect(updated?.name).toBe("Stable Org");
  });

  it("update can deactivate an organisation via status", async () => {
    const repo = createInMemoryOrganisationRepository();
    const created = await repo.create({ name: "Active Org" });
    const updated = await repo.update(created.id, { status: "inactive" });
    expect(updated?.status).toBe("inactive");
  });
});

// ─── 2. Postgres Repository (mock pool) ───────────────────────────────────────

describe("PostgresOrganisationRepository.findById", () => {
  it("queries with the correct id param", async () => {
    const row = {
      id: "org-001",
      name: "Test Org",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresOrganisationRepository(pool);
    const result = await repo.findById("org-001");

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1/i);
    expect(params[0]).toBe("org-001");
    expect(result?.id).toBe("org-001");
    expect(result?.name).toBe("Test Org");
    expect(result?.status).toBe("active");
  });

  it("returns null when no rows found", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresOrganisationRepository(pool);
    const result = await repo.findById("not-found");
    expect(result).toBeNull();
  });
});

describe("PostgresOrganisationRepository.findAll", () => {
  it("selects all organisations ordered by name", async () => {
    const { pool, query } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresOrganisationRepository(pool);
    await repo.findAll();

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ORDER BY name ASC/i);
  });
});

describe("PostgresOrganisationRepository.create", () => {
  it("inserts with gen_random_uuid() when no id provided", async () => {
    const row = {
      id: "db-generated-id",
      name: "New Org",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresOrganisationRepository(pool);
    const result = await repo.create({ name: "New Org" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/gen_random_uuid\(\)/i);
    expect(params[0]).toBe("New Org");
    expect(params[1]).toBe("active");
    expect(result.id).toBe("db-generated-id");
  });

  it("inserts with caller-supplied id when provided", async () => {
    const row = {
      id: "fixed-id",
      name: "Fixed Org",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresOrganisationRepository(pool);
    await repo.create({ id: "fixed-id", name: "Fixed Org" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/\$1/);
    expect(params[0]).toBe("fixed-id");
  });
});

describe("PostgresOrganisationRepository.update", () => {
  it("builds dynamic SET clause for name change", async () => {
    const row = {
      id: "org-001",
      name: "Updated Name",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { pool, query } = makeMockPool([{ rows: [row] }]);
    const repo = createPostgresOrganisationRepository(pool);
    await repo.update("org-001", { name: "Updated Name" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SET.*name = \$1/i);
    expect(sql).toMatch(/WHERE id = \$\d+/i);
    expect(params[0]).toBe("Updated Name");
  });

  it("returns null when the org does not exist", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const repo = createPostgresOrganisationRepository(pool);
    const result = await repo.update("ghost-id", { name: "Ghost" });
    expect(result).toBeNull();
  });
});

// ─── 3. OrganisationService ───────────────────────────────────────────────────

describe("OrganisationService — RBAC enforcement", () => {
  let repo: OrganisationRepository;

  beforeEach(() => {
    repo = createInMemoryOrganisationRepository();
  });

  it("listOrganisations throws 403 for non-admin", async () => {
    const service = createOrganisationService(repo);
    await expect(service.listOrganisations(makeNonAdmin())).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("getOrganisation throws 403 for non-admin", async () => {
    const service = createOrganisationService(repo);
    await expect(
      service.getOrganisation(makeNonAdmin(), SEED_ORGANISATION_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("createOrganisation throws 403 for non-admin", async () => {
    const service = createOrganisationService(repo);
    await expect(
      service.createOrganisation(makeNonAdmin(), { name: "Test" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("updateOrganisation throws 403 for non-admin", async () => {
    const service = createOrganisationService(repo);
    await expect(
      service.updateOrganisation(makeNonAdmin(), SEED_ORGANISATION_ID, {
        name: "New",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("OrganisationService — owner_admin operations", () => {
  let repo: OrganisationRepository;
  const admin = makeOwnerAdmin();

  beforeEach(() => {
    repo = createInMemoryOrganisationRepository();
  });

  it("listOrganisations returns all organisations for owner_admin", async () => {
    const service = createOrganisationService(repo);
    const result = await service.listOrganisations(admin);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("getOrganisation returns existing organisation", async () => {
    const service = createOrganisationService(repo);
    const org = await service.getOrganisation(admin, SEED_ORGANISATION_ID);
    expect(org.id).toBe(SEED_ORGANISATION_ID);
  });

  it("getOrganisation throws 404 for unknown id", async () => {
    const service = createOrganisationService(repo);
    await expect(
      service.getOrganisation(admin, "unknown-id"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("createOrganisation creates and returns the new organisation", async () => {
    const service = createOrganisationService(repo);
    const org = await service.createOrganisation(admin, { name: "Created Org" });
    expect(org.name).toBe("Created Org");
    expect(org.status).toBe("active");
    expect(org.id).toBeTruthy();
  });

  it("updateOrganisation updates name and returns updated entity", async () => {
    const service = createOrganisationService(repo);
    const created = await service.createOrganisation(admin, { name: "Old Name" });
    const updated = await service.updateOrganisation(admin, created.id, {
      name: "New Name",
    });
    expect(updated.name).toBe("New Name");
    expect(updated.id).toBe(created.id);
  });

  it("updateOrganisation throws 404 for unknown id", async () => {
    const service = createOrganisationService(repo);
    await expect(
      service.updateOrganisation(admin, "ghost-id", { name: "Ghost" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("updateOrganisation can deactivate an organisation", async () => {
    const service = createOrganisationService(repo);
    const created = await service.createOrganisation(admin, { name: "Active Org" });
    const updated = await service.updateOrganisation(admin, created.id, {
      status: "inactive",
    });
    expect(updated.status).toBe("inactive");
  });
});

// ─── 4. OrganisationController ────────────────────────────────────────────────

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
  return { res: { status, json } as unknown as import("express").Response, status, json };
}

describe("OrganisationController", () => {
  const admin = makeOwnerAdmin();
  let repo: OrganisationRepository;

  beforeEach(() => {
    repo = createInMemoryOrganisationRepository();
  });

  it("listOrganisations — 200 with data array", async () => {
    const service = createOrganisationService(repo);
    const handlers = createOrganisationHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(admin) as unknown as import("express").Request;

    await handlers.listOrganisations(req, res);

    expect(status).toHaveBeenCalledWith(200);
  });

  it("getOrganisation — 200 with data object for seed org", async () => {
    const service = createOrganisationService(repo);
    const handlers = createOrganisationHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { organisationId: SEED_ORGANISATION_ID },
    ) as unknown as import("express").Request;

    await handlers.getOrganisation(req, res);

    expect(status).toHaveBeenCalledWith(200);
  });

  it("getOrganisation — propagates 404 from service", async () => {
    const service = createOrganisationService(repo);
    const handlers = createOrganisationHandlers(service);
    const { res } = makeResponse();
    const req = makeRequest(
      admin,
      { organisationId: "no-such-org" },
    ) as unknown as import("express").Request;

    await expect(handlers.getOrganisation(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("createOrganisation — 201 with data on valid input", async () => {
    const service = createOrganisationService(repo);
    const handlers = createOrganisationHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      {},
      { name: "Brand New Org" },
    ) as unknown as import("express").Request;

    await handlers.createOrganisation(req, res);

    expect(status).toHaveBeenCalledWith(201);
  });

  it("createOrganisation — 401 when user is absent", async () => {
    const service = createOrganisationService(repo);
    const handlers = createOrganisationHandlers(service);
    const { res } = makeResponse();
    const req = { params: {}, body: { name: "Test" } } as unknown as import("express").Request;

    await expect(handlers.createOrganisation(req, res)).rejects.toBeInstanceOf(AppError);
  });

  it("updateOrganisation — 200 on valid patch", async () => {
    const service = createOrganisationService(repo);
    const handlers = createOrganisationHandlers(service);
    const { res, status } = makeResponse();
    const req = makeRequest(
      admin,
      { organisationId: SEED_ORGANISATION_ID },
      { name: "Patched Name" },
    ) as unknown as import("express").Request;

    await handlers.updateOrganisation(req, res);

    expect(status).toHaveBeenCalledWith(200);
  });
});
