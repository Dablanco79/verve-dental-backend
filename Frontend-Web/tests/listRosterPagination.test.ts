/**
 * listRosterPagination.test.ts
 *
 * GAP 1: Verifies that listRoster() correctly loops through all pages using
 * offset/limit pagination and returns the combined, deduplicated result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../src/api/client.js";
import type { RosterEntry } from "../src/types/roster.js";

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../src/auth/tokenStorage.js", () => ({
  getAccessToken: vi.fn().mockReturnValue("test-token"),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeEntry(id: string): RosterEntry {
  return {
    id,
    staffUserId: "s1",
    staffEmail: "s@test.au",
    rosteredClinicId: "c1",
    rosteredClinicName: "Clinic",
    shiftStartAt: "2026-01-15T22:00:00Z",
    shiftEndAt: "2026-01-16T07:00:00Z",
    shiftType: "standard",
    status: "scheduled",
    notes: null,
    createdByUserId: "a1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const PAGE_SIZE = 100;

/** Build a minimal mock Response for the given page payload. */
function makeFetchResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("listRoster pagination", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches page 1 and page 2, returns all entries with no duplicates", async () => {
    const TOTAL = 103;
    const page1Entries = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeEntry(`entry-${String(i)}`),
    );
    const page2Entries = Array.from({ length: 3 }, (_, i) =>
      makeEntry(`entry-${String(PAGE_SIZE + i)}`),
    );

    mockFetch.mockImplementation((urlString: string) => {
      const url = new URL(urlString);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
      const data = offset === 0 ? page1Entries : page2Entries;
      return makeFetchResponse({
        data,
        pagination: { limit: PAGE_SIZE, offset, total: TOTAL },
      });
    });

    const client = createApiClient({ apiBaseUrl: "http://test", pilotResetEnabled: false });
    const result = await client.listRoster("clinic-id", {
      from: "2026-01-01T00:00:00Z",
      to: "2026-02-01T00:00:00Z",
    });

    // Total length
    expect(result).toHaveLength(TOTAL);
    // Page-2 entry is present
    expect(result.some((e) => e.id === "entry-100")).toBe(true);
    // No duplicates
    expect(new Set(result.map((e) => e.id)).size).toBe(TOTAL);
    // Called exactly twice
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // First call has offset=0
    const firstUrl = new URL((mockFetch.mock.calls[0] as [string])[0]);
    expect(firstUrl.searchParams.get("offset")).toBe("0");
    // Second call has offset=100
    const secondUrl = new URL((mockFetch.mock.calls[1] as [string])[0]);
    expect(secondUrl.searchParams.get("offset")).toBe("100");
  });

  it("terminates correctly when all entries fit on one page", async () => {
    const TOTAL = 5;
    const entries = Array.from({ length: TOTAL }, (_, i) =>
      makeEntry(`entry-${String(i)}`),
    );

    mockFetch.mockImplementation(() =>
      makeFetchResponse({
        data: entries,
        pagination: { limit: PAGE_SIZE, offset: 0, total: TOTAL },
      }),
    );

    const client = createApiClient({ apiBaseUrl: "http://test", pilotResetEnabled: false });
    const result = await client.listRoster("clinic-id");

    expect(result).toHaveLength(TOTAL);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when total is 0", async () => {
    mockFetch.mockImplementation(() =>
      makeFetchResponse({
        data: [],
        pagination: { limit: PAGE_SIZE, offset: 0, total: 0 },
      }),
    );

    const client = createApiClient({ apiBaseUrl: "http://test", pilotResetEnabled: false });
    const result = await client.listRoster("clinic-id");

    expect(result).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
