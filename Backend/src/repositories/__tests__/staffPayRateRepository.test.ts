/**
 * staffPayRateRepository.test.ts
 *
 * Unit tests for the in-memory StaffPayRateRepository implementation.
 * Tests effective-date boundary semantics, open-rate closure, and overlap rejection.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";

import { createInMemoryStaffPayRateRepository } from "../staffPayRateRepository.js";
import type { StaffPayRateRepository } from "../staffPayRateRepository.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAFF_ID = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ADMIN_ID = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

// Concrete dates for boundary tests
const OLD_FROM = "2026-01-01";  // old rate effective_from
const NEW_FROM = "2026-10-01";  // new rate effective_from (= old rate's effective_to)

function makeCreateInput(overrides: Partial<Parameters<StaffPayRateRepository["createRate"]>[0]> = {}) {
  return {
    staffUserId: STAFF_ID,
    baseHourlyRateCents: 5000,
    employmentType: "full_time" as const,
    contractedWeeklyHours: 38,
    superRatePercent: 12.0,
    effectiveFrom: OLD_FROM,
    createdByUserId: ADMIN_ID,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("StaffPayRateRepository — in-memory", () => {
  let repo: StaffPayRateRepository;

  beforeEach(() => {
    repo = createInMemoryStaffPayRateRepository();
  });

  // ── 1. listByStaff — empty state ──────────────────────────────────────────

  it("returns empty array when no rates have been created", async () => {
    const rates = await repo.listByStaff(STAFF_ID);
    expect(rates).toEqual([]);
  });

  // ── 2. findEffectiveRate — no rates ───────────────────────────────────────

  it("returns null when no rates exist for a staff member", async () => {
    const rate = await repo.findEffectiveRate(STAFF_ID, "2026-06-01");
    expect(rate).toBeNull();
  });

  // ── 3. createRate — basic creation ───────────────────────────────────────

  it("creates a new rate and returns it with effectiveTo = null", async () => {
    const created = await repo.createRate(makeCreateInput());
    expect(created.id).toBeTruthy();
    expect(created.staffUserId).toBe(STAFF_ID);
    expect(created.baseHourlyRateCents).toBe(5000);
    expect(created.employmentType).toBe("full_time");
    expect(created.contractedWeeklyHours).toBe(38);
    expect(created.superRatePercent).toBe(12.0);
    expect(created.effectiveFrom).toBe(OLD_FROM);
    expect(created.effectiveTo).toBeNull();
  });

  // ── 4. Boundary: rate applies on effectiveFrom date ──────────────────────

  it("rate applies on its effectiveFrom date", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM }));
    const rate = await repo.findEffectiveRate(STAFF_ID, OLD_FROM);
    expect(rate).not.toBeNull();
    expect(rate?.effectiveFrom).toBe(OLD_FROM);
    expect(rate?.isConfigured).toBe(true);
  });

  // ── 5. Boundary: old rate applies day before new rate's effectiveFrom ────

  it("old rate applies on the day before new rate's effectiveFrom", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM, baseHourlyRateCents: 5000 }));
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM, baseHourlyRateCents: 6000 }));

    // Date "2026-09-30" is one day before NEW_FROM "2026-10-01"
    const rate = await repo.findEffectiveRate(STAFF_ID, "2026-09-30");
    expect(rate).not.toBeNull();
    expect(rate?.baseHourlyRateCents).toBe(5000); // old rate
    expect(rate?.effectiveFrom).toBe(OLD_FROM);
  });

  // ── 6. Boundary: new rate applies on its effectiveFrom ───────────────────

  it("new rate applies on its effectiveFrom date (exclusive effective_to boundary)", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM, baseHourlyRateCents: 5000 }));
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM, baseHourlyRateCents: 6000 }));

    // Date "2026-10-01" = NEW_FROM; old rate's effective_to is also "2026-10-01"
    // Exclusive: effective_to > date, so old rate (effective_to = "2026-10-01") does NOT apply
    const rate = await repo.findEffectiveRate(STAFF_ID, NEW_FROM);
    expect(rate).not.toBeNull();
    expect(rate?.baseHourlyRateCents).toBe(6000); // new rate
    expect(rate?.effectiveFrom).toBe(NEW_FROM);
  });

  // ── 7. Boundary: date equal to effective_to returns null / previous rate ─

  it("exclusive effective_to: date = effective_to does NOT return closed rate", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM, baseHourlyRateCents: 5000 }));
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM, baseHourlyRateCents: 6000 }));

    // After creating the second rate, the old rate has effective_to = NEW_FROM = "2026-10-01"
    // effective_to IS NULL OR effective_to > date  →  "2026-10-01" > "2026-10-01" is FALSE
    // So querying for "2026-10-01" should NOT return the old rate — it should return the new one.
    const rate = await repo.findEffectiveRate(STAFF_ID, "2026-10-01");
    expect(rate?.baseHourlyRateCents).toBe(6000); // new rate, not old rate
  });

  // ── 8. Historical lookup returns correct row ──────────────────────────────

  it("lookup for 2026-12-31 returns the new rate (still open)", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM, baseHourlyRateCents: 5000 }));
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM, baseHourlyRateCents: 6000 }));

    const rate = await repo.findEffectiveRate(STAFF_ID, "2026-12-31");
    expect(rate).not.toBeNull();
    expect(rate?.baseHourlyRateCents).toBe(6000);
    expect(rate?.effectiveTo).toBeNull();
  });

  // ── 9. Only one open-ended rate: second POST closes first ────────────────

  it("creating a second rate closes the first (sets effective_to = new rate's effectiveFrom)", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM }));
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM }));

    const all = await repo.listByStaff(STAFF_ID);
    expect(all).toHaveLength(2);

    const openRates = all.filter((r) => r.effectiveTo === null);
    expect(openRates).toHaveLength(1);
    expect(openRates[0]?.effectiveFrom).toBe(NEW_FROM);

    const closedRate = all.find((r) => r.effectiveFrom === OLD_FROM);
    expect(closedRate?.effectiveTo).toBe(NEW_FROM);
  });

  // ── 10. Overlap rejection ─────────────────────────────────────────────────

  it("rejects a new rate whose effectiveFrom <= existing open rate's effectiveFrom", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM }));

    // Same date as the existing open rate → should reject
    await expect(
      repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM })),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "RATE_OVERLAP",
    });
  });

  it("rejects a new rate whose effectiveFrom is before the existing open rate's effectiveFrom", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM }));

    // Earlier date than existing open rate → should also reject
    await expect(
      repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM })),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "RATE_OVERLAP",
    });
  });

  // ── 11. listByStaff returns newest first ─────────────────────────────────

  it("listByStaff returns rates sorted newest effectiveFrom first", async () => {
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM, baseHourlyRateCents: 5000 }));
    await repo.createRate(makeCreateInput({ effectiveFrom: NEW_FROM, baseHourlyRateCents: 6000 }));

    const rates = await repo.listByStaff(STAFF_ID);
    expect(rates[0]?.effectiveFrom).toBe(NEW_FROM);
    expect(rates[1]?.effectiveFrom).toBe(OLD_FROM);
  });

  // ── 12. Isolation between staff members ──────────────────────────────────

  it("rates for one staff member do not affect lookup for another", async () => {
    const OTHER_STAFF_ID = "cccccccc-0000-4000-8000-cccccccccccc";
    await repo.createRate(makeCreateInput({ effectiveFrom: OLD_FROM, baseHourlyRateCents: 5000 }));

    const rate = await repo.findEffectiveRate(OTHER_STAFF_ID, OLD_FROM);
    expect(rate).toBeNull();
  });

  // ── 13. Super rate is stored and returned accurately ─────────────────────

  it("stores and returns the specified super rate percent", async () => {
    await repo.createRate(makeCreateInput({ superRatePercent: 15.00 }));
    const rate = await repo.findEffectiveRate(STAFF_ID, OLD_FROM);
    expect(rate?.superRatePercent).toBe(15.00);
  });

  // ── 14. contractedWeeklyHours nullable ───────────────────────────────────

  it("allows null contractedWeeklyHours for casual staff", async () => {
    await repo.createRate(makeCreateInput({
      employmentType: "casual",
      contractedWeeklyHours: null,
    }));
    const rate = await repo.findEffectiveRate(STAFF_ID, OLD_FROM);
    expect(rate?.contractedWeeklyHours).toBeNull();
    expect(rate?.employmentType).toBe("casual");
  });
});
