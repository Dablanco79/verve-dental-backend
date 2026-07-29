/**
 * Refresh Lifecycle Regression Tests — P1 MISSING_REFRESH_TOKEN defect
 *
 * Covers:
 *   TEST 2  — Every fetch call (including refresh) sends credentials:"include"
 *   TEST 3  — Active session survives access-token expiry (401 → refresh → retry)
 *   TEST 9  — Concurrent 401 requests trigger exactly one refresh operation
 *   TEST 11 — No premature logout when multiple navigations fire after expiry
 *   TEST 12 — Genuine failed refresh redirects once to /login (no infinite loop)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api/client.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = { apiBaseUrl: "https://api.test" };

// ---------------------------------------------------------------------------
// localStorage stub
// ---------------------------------------------------------------------------

const storage: Record<string, string> = {};

function clearStorage() {
  const keys = Object.keys(storage);
  for (const key of keys) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete storage[key];
  }
}

beforeEach(() => {
  clearStorage();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(
    (key: string) => storage[key] ?? null,
  );
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    (key: string, value: string) => { storage[key] = value; },
  );
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
    (key: string) => { clearStorage(); void key; },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// TEST 2 — Every fetch call includes credentials:"include"
// ---------------------------------------------------------------------------

describe("TEST 2 — credentials:include is present on every request", () => {
  it("the refresh endpoint POST includes credentials:include", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({ data: { accessToken: "new-at", expiresIn: 900, user: {} } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);
    await client.refresh();

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.credentials).toBe("include");
  });

  it("authenticated API requests include credentials:include", async () => {
    storage["verve.accessToken"] = "valid-token";
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);
    await client.listClinics();

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.credentials).toBe("include");
  });
});

// ---------------------------------------------------------------------------
// TEST 3 — Session survives access-token expiry (401 → refresh → retry)
// ---------------------------------------------------------------------------

describe("TEST 3 — Session survives access-token expiry", () => {
  it("retries the original request after a successful refresh", async () => {
    storage["verve.accessToken"] = "expired-at";

    const responses: Response[] = [
      fail(401, "UNAUTHORIZED", "Expired"),
      ok({ data: { accessToken: "fresh-at", expiresIn: 900, user: {} } }),
      ok({ data: [] }),
    ];
    let i = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      const r = responses[i] ?? responses.at(-1) ?? ok({ data: null });
      i++;
      return Promise.resolve(r);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);
    const result = await client.listClinics();
    expect(result).toEqual([]);

    // original (401) + refresh + retry = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls[1]?.[0]).toContain("/auth/refresh");
  });

  it("stores the refreshed access token in storage", async () => {
    storage["verve.accessToken"] = "expired-at";

    const responses: Response[] = [
      fail(401, "UNAUTHORIZED", "Expired"),
      ok({ data: { accessToken: "new-at-stored", expiresIn: 900, user: {} } }),
      ok({ data: [] }),
    ];
    let i = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      const r = responses[i] ?? responses.at(-1) ?? ok({ data: null });
      i++;
      return Promise.resolve(r);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);
    await client.listClinics();
    expect(storage["verve.accessToken"]).toBe("new-at-stored");
  });
});

// ---------------------------------------------------------------------------
// TEST 9 — Concurrent 401 requests issue only one refresh
// ---------------------------------------------------------------------------

describe("TEST 9 — Concurrent 401 requests deduplicate refresh", () => {
  it("issues exactly one refresh for simultaneous 401 responses", async () => {
    storage["verve.accessToken"] = "expired-at";

    let refreshCount = 0;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshCount++;
        return Promise.resolve(
          ok({ data: { accessToken: "refreshed-at", expiresIn: 900, user: {} } }),
        );
      }
      // All protected requests return 401 on first encounter, 200 on retry.
      // We detect "retry" by checking whether the refresh has already happened.
      if (refreshCount > 0) {
        return Promise.resolve(ok({ data: [] }));
      }
      return Promise.resolve(fail(401, "UNAUTHORIZED", "Expired"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);

    // Fire three concurrent protected requests
    await Promise.all([
      client.listClinics(),
      client.listClinics(),
      client.listClinics(),
    ]);

    // Only one refresh must have been issued
    expect(refreshCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TEST 12 — No infinite retry loop on failed refresh
// ---------------------------------------------------------------------------

describe("TEST 12 — No infinite retry on failed refresh", () => {
  it("dispatches session-expired once and does not re-attempt refresh", async () => {
    storage["verve.accessToken"] = "expired-at";

    const sessionExpiredEvents: string[] = [];
    vi.spyOn(window, "dispatchEvent").mockImplementation((evt: Event) => {
      sessionExpiredEvents.push(evt.type);
      return true;
    });

    let refreshAttempts = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshAttempts++;
        return Promise.resolve(
          fail(400, "MISSING_REFRESH_TOKEN", "Refresh token required"),
        );
      }
      return Promise.resolve(fail(401, "UNAUTHORIZED", "Expired"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);
    await expect(client.listClinics()).rejects.toThrow(/session expired/i);

    // Exactly one refresh attempt — no loop
    expect(refreshAttempts).toBe(1);

    // Session-expired event dispatched exactly once
    expect(sessionExpiredEvents.filter((t) => t === "verve:session-expired")).toHaveLength(1);
  });

  it("refresh endpoint with skipAuthRetry does not re-attempt on 401", async () => {
    // When calling refresh() directly (used during session restore), a 401
    // on the refresh endpoint must bubble up without triggering another refresh.
    storage["verve.accessToken"] = "expired-at";

    const fetchMock = vi.fn().mockResolvedValue(
      fail(401, "UNAUTHORIZED", "Expired"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);
    await expect(client.refresh()).rejects.toThrow();

    // Only one call — no secondary retry of a retry
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// TEST 11 — No premature logout when navigation fires after token expiry
// ---------------------------------------------------------------------------

describe("TEST 11 — No premature logout during active navigation", () => {
  it("user remains authenticated when concurrent navigations succeed after refresh", async () => {
    storage["verve.accessToken"] = "expired-at";

    let refreshDone = false;
    const sessionExpiredFired = { value: false };

    vi.spyOn(window, "dispatchEvent").mockImplementation((evt: Event) => {
      if (evt.type === "verve:session-expired") sessionExpiredFired.value = true;
      return true;
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshDone = true;
        return Promise.resolve(
          ok({ data: { accessToken: "new-at", expiresIn: 900, user: {} } }),
        );
      }
      if (refreshDone) {
        return Promise.resolve(ok({ data: [] }));
      }
      return Promise.resolve(fail(401, "UNAUTHORIZED", "Expired"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient(CONFIG);

    // Simulate navigating Products → Purchase Orders after token expiry
    const [clinics, suppliers] = await Promise.all([
      client.listClinics(),
      client.listSuppliers(),
    ]);

    expect(clinics).toEqual([]);
    expect(suppliers).toEqual([]);
    expect(sessionExpiredFired.value).toBe(false);
  });
});
