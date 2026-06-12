import type { AppConfig } from "../config/index.js";
import * as tokenStorage from "../auth/tokenStorage.js";
import type {
  ApiErrorBody,
  AuthSession,
  AuthUser,
  ChangePasswordRequest,
  CreateUserRequest,
  HealthResponse,
  LoginResponse,
  ResetPasswordRequest,
  StaffUser,
} from "../types/index.js";
import type {
  CreateProductRequest,
  CreateProductResponse,
  InventoryItem,
  PurchaseOrderLine,
  ScanRequest,
  ScanResponse,
} from "../types/inventory.js";
import type {
  CreateShiftRequest,
  RosterEntry,
  UpdateShiftRequest,
} from "../types/roster.js";

type ApiEnvelope<T> = { data: T };

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function request<T>(
  config: AppConfig,
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const errorBody = await parseJson<ApiErrorBody>(response).catch(() => null);
    const message = errorBody?.error.message ?? `Request failed (${String(response.status)})`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const envelope = await parseJson<ApiEnvelope<T>>(response);
  return envelope.data;
}

export function createApiClient(config: AppConfig) {
  async function getHealth(): Promise<HealthResponse> {
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/v1/health`);

    if (!response.ok) {
      throw new Error(`Health check failed with status ${String(response.status)}`);
    }

    return response.json() as Promise<HealthResponse>;
  }

  async function login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>(config, "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async function verifyMfa(mfaToken: string, code: string): Promise<AuthSession> {
    return request<AuthSession>(config, "/api/v1/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ mfaToken, code }),
    });
  }

  async function refresh(refreshToken: string): Promise<AuthSession> {
    return request<AuthSession>(config, "/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }

  async function logout(refreshToken: string | null): Promise<void> {
    await request<undefined>(
      config,
      "/api/v1/auth/logout",
      {
        method: "POST",
        body: JSON.stringify({ refreshToken: refreshToken ?? undefined }),
      },
      tokenStorage.getAccessToken(),
    );
  }

  async function getMe(accessToken: string): Promise<AuthUser> {
    return request<AuthUser>(config, "/api/v1/auth/me", {}, accessToken);
  }

  function requireAccessToken(): string {
    const accessToken = tokenStorage.getAccessToken();

    if (!accessToken) {
      throw new Error("Authentication required");
    }

    return accessToken;
  }

  async function listInventory(clinicId: string): Promise<InventoryItem[]> {
    return request<InventoryItem[]>(
      config,
      `/api/v1/clinics/${clinicId}/inventory`,
      {},
      requireAccessToken(),
    );
  }

  async function handleScan(clinicId: string, body: ScanRequest): Promise<ScanResponse> {
    return request<ScanResponse>(
      config,
      `/api/v1/clinics/${clinicId}/scans`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      requireAccessToken(),
    );
  }

  async function createProduct(
    clinicId: string,
    body: CreateProductRequest,
  ): Promise<CreateProductResponse> {
    return request<CreateProductResponse>(
      config,
      `/api/v1/clinics/${clinicId}/products`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      requireAccessToken(),
    );
  }

  async function listUsers(clinicId: string): Promise<StaffUser[]> {
    return request<StaffUser[]>(
      config,
      `/api/v1/clinics/${clinicId}/users`,
      {},
      requireAccessToken(),
    );
  }

  async function createUser(clinicId: string, body: CreateUserRequest): Promise<StaffUser> {
    return request<StaffUser>(
      config,
      `/api/v1/clinics/${clinicId}/users`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      requireAccessToken(),
    );
  }

  async function changePassword(body: ChangePasswordRequest): Promise<void> {
    await request<{ message: string }>(
      config,
      "/api/v1/auth/change-password",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      requireAccessToken(),
    );
  }

  async function listPurchaseOrders(clinicId: string): Promise<PurchaseOrderLine[]> {
    return request<PurchaseOrderLine[]>(
      config,
      `/api/v1/clinics/${clinicId}/purchase-orders`,
      {},
      requireAccessToken(),
    );
  }

  async function listRoster(
    clinicId: string,
    params?: { from?: string; to?: string; status?: string },
  ): Promise<RosterEntry[]> {
    const query = new URLSearchParams();
    if (params?.from) query.set("from", params.from);
    if (params?.to) query.set("to", params.to);
    if (params?.status) query.set("status", params.status);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<RosterEntry[]>(
      config,
      `/api/v1/clinics/${clinicId}/roster${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getMyShifts(
    clinicId: string,
    params?: { from?: string; to?: string },
  ): Promise<RosterEntry[]> {
    const query = new URLSearchParams();
    if (params?.from) query.set("from", params.from);
    if (params?.to) query.set("to", params.to);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<RosterEntry[]>(
      config,
      `/api/v1/clinics/${clinicId}/roster/me${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function createShift(
    clinicId: string,
    body: CreateShiftRequest,
  ): Promise<RosterEntry> {
    return request<RosterEntry>(
      config,
      `/api/v1/clinics/${clinicId}/roster`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateShift(
    clinicId: string,
    entryId: string,
    body: UpdateShiftRequest,
  ): Promise<RosterEntry> {
    return request<RosterEntry>(
      config,
      `/api/v1/clinics/${clinicId}/roster/${entryId}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function cancelShift(clinicId: string, entryId: string): Promise<RosterEntry> {
    return request<RosterEntry>(
      config,
      `/api/v1/clinics/${clinicId}/roster/${entryId}`,
      { method: "DELETE" },
      requireAccessToken(),
    );
  }

  async function resetUserPassword(
    clinicId: string,
    userId: string,
    body: ResetPasswordRequest,
  ): Promise<void> {
    await request<{ message: string }>(
      config,
      `/api/v1/clinics/${clinicId}/users/${userId}/reset-password`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      requireAccessToken(),
    );
  }

  return {
    getHealth,
    login,
    verifyMfa,
    refresh,
    logout,
    getMe,
    listInventory,
    handleScan,
    createProduct,
    listUsers,
    createUser,
    changePassword,
    resetUserPassword,
    listPurchaseOrders,
    listRoster,
    getMyShifts,
    createShift,
    updateShift,
    cancelShift,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
