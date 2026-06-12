import type { AppConfig } from "../config/index.js";
import * as tokenStorage from "../auth/tokenStorage.js";
import type {
  ApiErrorBody,
  AuthSession,
  AuthUser,
  HealthResponse,
  LoginResponse,
} from "../types/index.js";
import type {
  CreateProductRequest,
  CreateProductResponse,
  InventoryItem,
  ScanRequest,
  ScanResponse,
} from "../types/inventory.js";

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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
