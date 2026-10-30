import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../src/api/client.js";

const { mockGetAccessToken } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(() => "test-token"),
}));
const mockCreateObjectUrl = vi.fn(() => "blob:weekly-roster");
const mockRevokeObjectUrl = vi.fn();
const mockAnchorClick = vi.fn();

vi.mock("../src/auth/tokenStorage.js", () => ({
  getAccessToken: mockGetAccessToken,
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

describe("weekly roster PDF API download", () => {
  beforeEach(() => {
    mockGetAccessToken.mockReturnValue("test-token");
    mockCreateObjectUrl.mockClear();
    mockRevokeObjectUrl.mockClear();
    mockAnchorClick.mockClear();
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mockCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mockRevokeObjectUrl,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      mockAnchorClick,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads the authenticated PDF using the safe server filename", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(new Blob(["%PDF-test"], {
      type: "application/pdf",
    }), {
      status: 200,
      headers: {
        "Content-Disposition":
          'attachment; filename="RENQOR_Bentleigh-East_Roster_2026-11-16.pdf"',
      },
    }));
    const client = createApiClient({
      apiBaseUrl: "http://test",
      pilotResetEnabled: false,
    });

    const filename = await client.exportWeeklyRosterPdf(
      "clinic/id",
      "2026-11-16",
    );

    expect(filename).toBe("RENQOR_Bentleigh-East_Roster_2026-11-16.pdf");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test/api/v1/clinics/clinic%2Fid/roster/export.pdf?weekStart=2026-11-16",
      expect.objectContaining({
        credentials: "include",
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    expect(mockAnchorClick).toHaveBeenCalledOnce();
    expect(mockRevokeObjectUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(mockRevokeObjectUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mockRevokeObjectUrl).toHaveBeenCalledWith("blob:weekly-roster");
  });

  it("rejects unsafe server filenames and uses a deterministic fallback", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Blob(["%PDF-test"]), {
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="../../unsafe.pdf"',
      },
    }));
    const client = createApiClient({
      apiBaseUrl: "http://test",
      pilotResetEnabled: false,
    });

    await expect(
      client.exportWeeklyRosterPdf("clinic-id", "2026-11-16"),
    ).resolves.toBe("RENQOR_Roster_2026-11-16.pdf");
  });

  it("surfaces API errors without creating a download", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Roster access denied" },
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }));
    const client = createApiClient({
      apiBaseUrl: "http://test",
      pilotResetEnabled: false,
    });

    await expect(
      client.exportWeeklyRosterPdf("clinic-id", "2026-11-16"),
    ).rejects.toThrow("Roster access denied");
    expect(mockCreateObjectUrl).not.toHaveBeenCalled();
  });
});
