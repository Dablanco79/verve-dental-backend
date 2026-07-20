/**
 * Stocktake List API — response shape verification
 *
 * These tests verify that GET /api/v1/clinics/:clinicId/stocktakes returns
 * the correct JSON envelope shape, including the empty-list case that caused
 * the production "Cannot read properties of undefined (reading 'total')" error.
 *
 * The root cause was that the endpoint originally returned:
 *   { data: [...sessions], pagination: { total, limit, offset } }
 *
 * The request<T> client helper always strips the outer `data` wrapper, so
 * `envelope.pagination` was undefined on the client side.
 *
 * The fix wraps the paginated payload inside `data`:
 *   { data: { items: [...sessions], total, limit, offset } }
 *
 * Coverage:
 *  1. Empty list — response shape is correct (no crash on total)
 *  2. Empty list — total is 0
 *  3. Empty list — items is an empty array
 *  4. Populated list — items contains created sessions
 *  5. Populated list — total reflects the session count
 *  6. Status filter — returns only matching sessions
 *  7. Status filter — returns empty items when none match
 *  8. Unauthenticated request — 401
 *  9. Pagination — limit and offset fields are present
 */

import request from "supertest";

import { SEED_CLINIC_A_ID } from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const STOCKTAKE_URL = (clinicId: string) =>
  `/api/v1/clinics/${clinicId}/stocktakes`;

type StocktakePage = {
  items: unknown[];
  total: number;
  limit: number;
  offset: number;
};

type ApiData<T> = { data: T };

// ---------------------------------------------------------------------------
// Empty list — the first-run scenario that triggered the production error
// ---------------------------------------------------------------------------

describe("GET /api/v1/clinics/:clinicId/stocktakes — empty list", () => {
  it("returns 200 with the correct envelope shape when no sessions exist", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);

    // The response must have a top-level `data` key containing the page.
    // This is what the client's request<T> helper expects.
    const body = res.body as ApiData<StocktakePage>;
    expect(body).toHaveProperty("data");
    expect(body.data).toHaveProperty("items");
    expect(body.data).toHaveProperty("total");
    expect(body.data).toHaveProperty("limit");
    expect(body.data).toHaveProperty("offset");

    // Critically: response must NOT have a root-level `pagination` key,
    // which was the inconsistent shape that caused the production crash.
    expect(body).not.toHaveProperty("pagination");
  });

  it("returns total = 0 when no sessions exist", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    const body = res.body as ApiData<StocktakePage>;
    expect(body.data.total).toBe(0);
  });

  it("returns an empty items array when no sessions exist", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    const body = res.body as ApiData<StocktakePage>;
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.items).toHaveLength(0);
  });

  it("includes limit and offset in the response", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    const res = await request(app)
      .get(`${STOCKTAKE_URL(SEED_CLINIC_A_ID)}?limit=25&offset=0`)
      .set("Authorization", `Bearer ${token}`);

    const body = res.body as ApiData<StocktakePage>;
    expect(body.data.limit).toBe(25);
    expect(body.data.offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Populated list
// ---------------------------------------------------------------------------

describe("GET /api/v1/clinics/:clinicId/stocktakes — populated list", () => {
  it("returns created sessions in the items array", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Create a session first.
    const createRes = await request(app)
      .post(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "July Stocktake" });

    expect(createRes.status).toBe(201);

    const listRes = await request(app)
      .get(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    const body = listRes.body as ApiData<StocktakePage>;
    expect(body.data.total).toBeGreaterThanOrEqual(1);
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);

    const created = body.data.items.find(
      (s) => (s as { name: string }).name === "July Stocktake",
    );
    expect(created).toBeDefined();
  });

  it("total reflects the number of sessions for the clinic", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await request(app)
      .post(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Session Alpha" });

    await request(app)
      .post(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Session Beta" });

    const listRes = await request(app)
      .get(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`);

    const body = listRes.body as ApiData<StocktakePage>;
    expect(body.data.total).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

describe("GET /api/v1/clinics/:clinicId/stocktakes — status filter", () => {
  it("returns only draft sessions when status=draft is applied", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    await request(app)
      .post(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Draft Session" });

    const listRes = await request(app)
      .get(`${STOCKTAKE_URL(SEED_CLINIC_A_ID)}?status=draft`)
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const body = listRes.body as ApiData<StocktakePage>;
    expect(body.data.items.every((s) => (s as { status: string }).status === "draft")).toBe(true);
  });

  it("returns empty items and total=0 when no sessions match the filter", async () => {
    const app = await createTestApp();
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");

    // Only draft sessions exist; filter for completed should return nothing.
    await request(app)
      .post(STOCKTAKE_URL(SEED_CLINIC_A_ID))
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "A Draft Session" });

    const listRes = await request(app)
      .get(`${STOCKTAKE_URL(SEED_CLINIC_A_ID)}?status=completed`)
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const body = listRes.body as ApiData<StocktakePage>;
    expect(body.data.items).toHaveLength(0);
    expect(body.data.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe("GET /api/v1/clinics/:clinicId/stocktakes — authentication", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const app = await createTestApp();

    const res = await request(app).get(STOCKTAKE_URL(SEED_CLINIC_A_ID));

    expect(res.status).toBe(401);
  });
});
