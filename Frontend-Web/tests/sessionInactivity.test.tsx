import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContext } from "react";

import { AuthContext } from "../src/auth/AuthContext.js";
import { AuthProvider } from "../src/auth/AuthProvider.js";
import type { AuthContextValue } from "../src/auth/AuthContext.js";
import type { AuthSession, AuthUser } from "../src/types/index.js";

const {
  mockGetMe,
  mockRefresh,
  mockRecordActivity,
  mockLogout,
} = vi.hoisted(() => ({
  mockGetMe: vi.fn(),
  mockRefresh: vi.fn(),
  mockRecordActivity: vi.fn(),
  mockLogout: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    login: vi.fn(),
    verifyMfa: vi.fn(),
    setupMfa: vi.fn(),
    confirmMfa: vi.fn(),
    getMe: mockGetMe,
    refresh: mockRefresh,
    recordActivity: mockRecordActivity,
    logout: mockLogout,
  }),
}));

const USER: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@clinic-a.au",
  role: "owner_admin",
  homeClinicId: "11111111-1111-4111-8111-111111111111",
  homeClinicName: "Clinic A",
  firstName: null,
  lastName: null,
  displayName: null,
  permissions: [],
};

const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

function tokenIssuedAt(timestamp: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${encode({ alg: "none" })}.${encode({
    iat: Math.floor(timestamp / 1000),
    permissions: [],
  })}.signature`;
}

const SESSION: AuthSession = {
  accessToken: tokenIssuedAt(BASE_TIME),
  expiresIn: 900,
  user: USER,
};

let context: AuthContextValue | null = null;
const currentContext = () => context;

function CaptureContext() {
  context = useContext(AuthContext);
  return null;
}

function renderProvider() {
  return render(
    <AuthProvider>
      <CaptureContext />
    </AuthProvider>,
  );
}

describe("persistent session inactivity enforcement", () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    context = null;
    vi.clearAllMocks();
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(BASE_TIME);
    mockGetMe.mockResolvedValue(USER);
    mockRefresh.mockResolvedValue(SESSION);
    mockRecordActivity.mockResolvedValue(undefined);
    mockLogout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("restores a session after 59 minutes of inactivity", async () => {
    window.localStorage.setItem("verve.accessToken", tokenIssuedAt(BASE_TIME));
    window.localStorage.setItem("verve.lastUserActivityAt", String(BASE_TIME));
    nowSpy.mockReturnValue(BASE_TIME + 59 * 60 * 1000);

    renderProvider();
    await waitFor(() => { expect(context?.isLoading).toBe(false); });

    expect(mockGetMe).toHaveBeenCalledOnce();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(context?.user).toEqual(USER);
  });

  it("requires login after browser refresh or restart beyond 60 minutes", async () => {
    window.localStorage.setItem("verve.accessToken", tokenIssuedAt(BASE_TIME));
    window.localStorage.setItem("verve.lastUserActivityAt", String(BASE_TIME));
    nowSpy.mockReturnValue(BASE_TIME + 60 * 60 * 1000 + 1);
    // A stalled revocation request must not keep the expired session visible
    // or block the login screen.
    mockLogout.mockReturnValue(new Promise(() => undefined));

    renderProvider();
    await waitFor(() => { expect(context?.isLoading).toBe(false); });

    expect(mockLogout).toHaveBeenCalledOnce();
    expect(mockGetMe).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(currentContext()?.user).toBeNull();
  });

  it("allows silent refresh before idle expiry but not after it", async () => {
    window.localStorage.setItem("verve.accessToken", tokenIssuedAt(BASE_TIME));
    window.localStorage.setItem("verve.lastUserActivityAt", String(BASE_TIME));
    nowSpy.mockReturnValue(BASE_TIME + 59 * 60 * 1000);
    mockGetMe.mockRejectedValue(new Error("expired access token"));

    const first = renderProvider();
    await waitFor(() => { expect(context?.isLoading).toBe(false); });
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(context?.user).toEqual(USER);
    first.unmount();

    vi.clearAllMocks();
    context = null;
    mockLogout.mockResolvedValue(undefined);
    nowSpy.mockReturnValue(BASE_TIME + 60 * 60 * 1000 + 1);
    renderProvider();
    await waitFor(() => { expect(context?.isLoading).toBe(false); });

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(currentContext()?.user).toBeNull();
  });

  it("expires a suspended tab before visibility restoration can reset activity", async () => {
    window.localStorage.setItem("verve.accessToken", tokenIssuedAt(BASE_TIME));
    window.localStorage.setItem("verve.lastUserActivityAt", String(BASE_TIME));
    renderProvider();
    await waitFor(() => { expect(context?.user).toEqual(USER); });

    nowSpy.mockReturnValue(BASE_TIME + 60 * 60 * 1000 + 1);
    const visibilitySpy = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => { expect(context?.user).toBeNull(); });
    expect(mockLogout).toHaveBeenCalledOnce();
    visibilitySpy.mockRestore();
  });

  it("records only genuine interaction as user activity", async () => {
    window.localStorage.setItem("verve.accessToken", tokenIssuedAt(BASE_TIME));
    window.localStorage.setItem("verve.lastUserActivityAt", String(BASE_TIME));
    renderProvider();
    await waitFor(() => { expect(context?.user).toEqual(USER); });

    nowSpy.mockReturnValue(BASE_TIME + 10 * 60 * 1000);
    expect(window.localStorage.getItem("verve.lastUserActivityAt")).toBe(String(BASE_TIME));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });

    expect(window.localStorage.getItem("verve.lastUserActivityAt")).toBe(
      String(BASE_TIME + 10 * 60 * 1000),
    );
    expect(mockRecordActivity).toHaveBeenCalledOnce();
  });

  it("propagates logout to other tabs through localStorage", async () => {
    const accessToken = tokenIssuedAt(BASE_TIME);
    window.localStorage.setItem("verve.accessToken", accessToken);
    window.localStorage.setItem("verve.lastUserActivityAt", String(BASE_TIME));
    renderProvider();
    await waitFor(() => { expect(context?.user).toEqual(USER); });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "verve.accessToken",
          oldValue: accessToken,
          newValue: null,
        }),
      );
    });

    expect(context?.user).toBeNull();
  });
});
