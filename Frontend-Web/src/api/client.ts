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
  MfaSetupData,
  ResetPasswordRequest,
  StaffUser,
  UpdateUserRequest,
} from "../types/index.js";
import type {
  AdjustInventoryRequest,
  AdjustInventoryResponse,
  AdjustmentsFilters,
  AdjustmentsPage,
  AddPoLineRequest,
  CreateProductRequest,
  CreateProductResponse,
  CreatePurchaseOrderRequest,
  InventoryItem,
  MasterProductImportResult,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderLine,
  ReceiveInventoryRequest,
  ReceivePoRequest,
  ReceivePoResult,
  ScanRequest,
  ScanResponse,
  UpdatePoLineRequest,
  UpdatePurchaseOrderRequest,
} from "../types/inventory.js";
import type {
  CreateShiftRequest,
  RosterEntry,
  UpdateShiftRequest,
} from "../types/roster.js";
import type { LaborForecastSummary } from "../types/forecast.js";
import type {
  MaterialShortfallAlert,
  SkuDemandProjection,
} from "../types/materialsForecast.js";
import type { ClinicData, CreateClinicData, UpdateClinicData } from "../types/clinic.js";
import type {
  CreateOrganisationData,
  OrganisationData,
  UpdateOrganisationData,
} from "../types/organisation.js";
import type {
  CreateLegalEntityData,
  LegalEntityData,
  UpdateLegalEntityData,
} from "../types/legalEntity.js";
import type { Invoice, InvoiceFilters, RecordPaymentRequest } from "../types/billing.js";
import type {
  AllClinicsDashboardKpis,
  AuditEvent,
  AuditEventsFilters,
  AuditEventsPage,
  DashboardFilters,
  DashboardKpis,
  InventoryReport,
  RevenueReport,
  RevenueReportFilters,
  StaffReport,
  StaffReportFilters,
} from "../types/analytics.js";
import type {
  ApproveLeaveRequest,
  ApproveTimesheetRequest,
  ClockInRequest,
  ClockOutRequest,
  CreateLeaveRequest,
  CreateManualTimesheetRequest,
  LeaveFilters,
  LeaveRequest,
  RejectLeaveRequest,
  RejectTimesheetRequest,
  TimesheetEntry,
  TimesheetFilters,
  VerifyAttendanceRequest,
} from "../types/payroll.js";
import type {
  ConfirmImportResult,
  ConfirmImportRequest,
  CatalogueImportConfirmResult,
  CatalogueImportPreviewResult,
  ReviewedCatalogueImportRequest,
  ReviewedCatalogueImportResult,
  CreateSupplierRequest,
  ListSupplierInvoicesParams,
  ListSuppliersParams,
  Supplier,
  SupplierIntelligenceResult,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceStatus,
  SupplierProduct,
  UpdateSupplierInvoiceLineRequest,
  UpdateSupplierInvoiceRequest,
  UpdateSupplierRequest,
  UploadAndExtractResult,
  ReceiveInvoiceRequest,
  ReceiveInvoiceResult,
} from "../types/supplier.js";
import type {
  CreateSupplierRelationshipRequest,
  ListSupplierRelationshipsParams,
  SupplierRelationship,
  UpdateSupplierRelationshipRequest,
} from "../types/supplierRelationship.js";
import type {
  CreateProcurementPolicyRequest,
  ListProcurementPoliciesParams,
  ProcurementPolicy,
  UpdateProcurementPolicyRequest,
} from "../types/procurementPolicy.js";
import type {
  CreateSupplierContractRequest,
  ListSupplierContractsParams,
  SupplierContract,
  UpdateSupplierContractRequest,
} from "../types/supplierContract.js";
import type {
  CreateSupplierContractPriceRequest,
  SupplierContractPrice,
  UpdateSupplierContractPriceRequest,
} from "../types/supplierContractPrice.js";
import type {
  CreateMasterProductRequest,
  ListMasterProductsParams,
  MasterProduct,
  MasterProductsPage,
  UpdateMasterProductRequest,
  ConfirmMatchRequest,
  ConfirmedSupplierProductMapping,
  SuggestMatchesRequest,
  SuggestMatchesResult,
} from "../types/masterProduct.js";
import type {
  CompleteStocktakeResponse,
  CreateStocktakeSessionRequest,
  StocktakeLine,
  StocktakeSession,
  StocktakeSessionsPage,
  StocktakeSessionFilters,
  UpdateStocktakeLineRequest,
  UpdateStocktakeSessionRequest,
} from "../types/stocktake.js";

type ApiEnvelope<T> = { data: T };

/** Default request timeout in milliseconds (30 s). */
const REQUEST_TIMEOUT_MS = 30_000;
const SESSION_EXPIRED_EVENT = "verve:session-expired";

class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

let refreshPromise: Promise<AuthSession> | null = null;

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function dispatchSessionExpired(): void {
  tokenStorage.clearAccessToken();
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("verve.sessionExpired", "1");
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

async function refreshAccessToken(config: AppConfig): Promise<AuthSession> {
  refreshPromise ??= request<AuthSession>(
    config,
    "/api/v1/auth/refresh",
    { method: "POST" },
    null,
    { skipAuthRetry: true },
  ).finally(() => {
    refreshPromise = null;
  });
  return await refreshPromise;
}

async function request<T>(
  config: AppConfig,
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
  options: { skipAuthRetry?: boolean } = {},
): Promise<T> {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  // Abort the request if it does not complete within the timeout window.
  // This prevents the UI from showing an infinite "Loading…" state when the
  // server hangs (e.g. due to a pool exhaustion or connection leak).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw fetchErr;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await parseJson<ApiErrorBody>(response).catch(() => null);
    const message = errorBody?.error.message ?? `Request failed (${String(response.status)})`;
    const code = errorBody?.error.code ?? null;

    if (response.status === 401 && accessToken && !options.skipAuthRetry) {
      try {
        const session = await refreshAccessToken(config);
        tokenStorage.setAccessToken(session.accessToken);
        return await request<T>(config, path, init, session.accessToken, { skipAuthRetry: true });
      } catch {
        dispatchSessionExpired();
        throw new Error("Your session expired. Please log in again.");
      }
    }

    throw new ApiRequestError(message, response.status, code);
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

  async function refresh(): Promise<AuthSession> {
    return request<AuthSession>(config, "/api/v1/auth/refresh", {
      method: "POST",
    });
  }

  async function logout(): Promise<void> {
    await request<undefined>(
      config,
      "/api/v1/auth/logout",
      { method: "POST" },
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

  async function getInventoryItem(clinicId: string, itemId: string): Promise<InventoryItem> {
    return request<InventoryItem>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/inventory/${encodeURIComponent(itemId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function adjustInventory(
    clinicId: string,
    body: AdjustInventoryRequest,
  ): Promise<AdjustInventoryResponse> {
    return request<AdjustInventoryResponse>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/inventory/adjust`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function receiveInventory(
    clinicId: string,
    body: ReceiveInventoryRequest,
  ): Promise<AdjustInventoryResponse> {
    return request<AdjustInventoryResponse>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/inventory/receive`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  /**
   * Lists paginated inventory adjustments for a clinic.
   * The backend returns { data: [...], pagination: { total, limit, offset } }
   * which differs from the standard { data: T } envelope, so we parse the
   * response body manually to capture both the items array and pagination.
   */
  async function listAdjustments(
    clinicId: string,
    filters: AdjustmentsFilters = {},
  ): Promise<AdjustmentsPage> {
    const query = new URLSearchParams();
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    if (filters.offset !== undefined) query.set("offset", String(filters.offset));
    if (filters.itemId !== undefined) query.set("itemId", filters.itemId);
    const qs = query.toString() ? `?${query.toString()}` : "";
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const accessToken = requireAccessToken();

    const response = await fetch(
      `${baseUrl}/api/v1/clinics/${encodeURIComponent(clinicId)}/inventory/adjustments${qs}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      },
    );

    if (!response.ok) {
      const errorBody = await response
        .json()
        .catch(() => null) as ApiErrorBody | null;
      const message =
        errorBody?.error.message ?? `Request failed (${String(response.status)})`;
      throw new Error(message);
    }

    type RawEnvelope = {
      data: AdjustmentsPage["items"];
      pagination: { total: number; limit: number; offset: number };
    };
    const envelope = await response.json() as RawEnvelope;
    return {
      items: envelope.data,
      total: envelope.pagination.total,
      limit: envelope.pagination.limit,
      offset: envelope.pagination.offset,
    };
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

  async function updateUser(
    clinicId: string,
    userId: string,
    body: UpdateUserRequest,
  ): Promise<StaffUser> {
    return request<StaffUser>(
      config,
      `/api/v1/clinics/${clinicId}/users/${userId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
      requireAccessToken(),
    );
  }

  // ── MFA enrollment ─────────────────────────────────────────────────────────

  /**
   * Initiates MFA setup for the current user.
   * Accepts either an enrollmentToken (forced enrollment at login) or falls
   * back to the stored access token (voluntary enrollment from Settings).
   * Returns the TOTP secret and otpauth:// URI needed to display the QR code.
   */
  async function setupMfa(enrollmentToken?: string): Promise<MfaSetupData> {
    const token = enrollmentToken ?? requireAccessToken();
    return request<MfaSetupData>(config, "/api/v1/auth/mfa/setup", { method: "POST" }, token);
  }

  /**
   * Confirms MFA enrollment by submitting the first TOTP code.
   * Uses the enrollmentToken when supplied; otherwise uses the access token.
   * On success the backend marks MFA as enabled for the user.
   */
  async function confirmMfa(code: string, enrollmentToken?: string): Promise<void> {
    const token = enrollmentToken ?? requireAccessToken();
    await request<{ message: string }>(
      config,
      "/api/v1/auth/mfa/confirm",
      { method: "POST", body: JSON.stringify({ code }) },
      token,
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
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders`,
      {},
      requireAccessToken(),
    );
  }

  async function getPurchaseOrderDetail(
    clinicId: string,
    poId: string,
  ): Promise<PurchaseOrderDetail> {
    return request<PurchaseOrderDetail>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createPurchaseOrder(
    clinicId: string,
    body: CreatePurchaseOrderRequest,
  ): Promise<PurchaseOrder> {
    return request<PurchaseOrder>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updatePurchaseOrder(
    clinicId: string,
    poId: string,
    body: UpdatePurchaseOrderRequest,
  ): Promise<PurchaseOrder> {
    return request<PurchaseOrder>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function submitPurchaseOrder(
    clinicId: string,
    poId: string,
  ): Promise<PurchaseOrderDetail> {
    return request<PurchaseOrderDetail>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}/submit`,
      {
        method: "PATCH",
        body: JSON.stringify({}),
      },
      requireAccessToken(),
    );
  }

  async function cancelPurchaseOrder(
    clinicId: string,
    poId: string,
  ): Promise<{ id: string; status: string; updatedAt: string }> {
    return request<{ id: string; status: string; updatedAt: string }>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}/cancel`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function addPoLine(
    clinicId: string,
    poId: string,
    body: AddPoLineRequest,
  ): Promise<PurchaseOrderLine> {
    return request<PurchaseOrderLine>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}/lines`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updatePoLine(
    clinicId: string,
    poId: string,
    lineId: string,
    body: UpdatePoLineRequest,
  ): Promise<PurchaseOrderLine> {
    return request<PurchaseOrderLine>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}/lines/${encodeURIComponent(lineId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function removePoLine(
    clinicId: string,
    poId: string,
    lineId: string,
  ): Promise<void> {
    await request<undefined>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}/lines/${encodeURIComponent(lineId)}`,
      { method: "DELETE" },
      requireAccessToken(),
    );
  }

  async function receivePurchaseOrder(
    clinicId: string,
    poId: string,
    body: ReceivePoRequest,
  ): Promise<ReceivePoResult> {
    return request<ReceivePoResult>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}/receive`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function exportPurchaseOrdersCsv(clinicId: string): Promise<void> {
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const accessToken = requireAccessToken();
    const response = await fetch(
      `${baseUrl}/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/export.csv`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      },
    );

    if (!response.ok) {
      // Attempt to extract a structured backend error message.
      let errorMessage = `Export failed (${String(response.status)})`;
      try {
        const errJson = await response.json() as { error?: { message?: string } };
        if (errJson.error?.message) {
          errorMessage = errJson.error.message;
        }
      } catch {
        // Non-JSON body — keep the status-code message.
      }
      throw new Error(errorMessage);
    }

    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filenameMatch = /filename="([^"]+)"/.exec(disposition);
    const filename = filenameMatch?.[1] ?? `purchase-orders-${clinicId}.csv`;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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

  /**
   * GET /clinics
   * owner_admin: returns all active clinics ordered by name.
   * All other roles: returns a single-element array containing their home clinic.
   */
  async function listClinics(): Promise<ClinicData[]> {
    return request<ClinicData[]>(
      config,
      "/api/v1/clinics",
      {},
      requireAccessToken(),
    );
  }

  /**
   * POST /clinics (owner_admin only)
   * Creates a new clinic with the given name and timezone.
   * Additional fields (ABN, address, etc.) are applied via updateClinicSettings
   * in a subsequent PATCH once the clinic ID is known.
   */
  async function createClinic(data: CreateClinicData): Promise<ClinicData> {
    return request<ClinicData>(
      config,
      "/api/v1/clinics",
      { method: "POST", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  async function getClinic(clinicId: string): Promise<ClinicData> {
    return request<ClinicData>(
      config,
      `/api/v1/clinics/${clinicId}`,
      {},
      requireAccessToken(),
    );
  }

  async function updateClinicSettings(
    clinicId: string,
    data: UpdateClinicData,
  ): Promise<ClinicData> {
    return request<ClinicData>(
      config,
      `/api/v1/clinics/${clinicId}`,
      { method: "PATCH", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  // ── Billing ────────────────────────────────────────────────────────────────

  async function listInvoices(
    clinicId: string,
    filters: InvoiceFilters = {},
  ): Promise<Invoice[]> {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<Invoice[]>(
      config,
      `/api/v1/clinics/${clinicId}/billing/invoices${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getInvoice(clinicId: string, invoiceId: string): Promise<Invoice> {
    return request<Invoice>(
      config,
      `/api/v1/clinics/${clinicId}/billing/invoices/${invoiceId}`,
      {},
      requireAccessToken(),
    );
  }

  async function recordPayment(
    clinicId: string,
    invoiceId: string,
    body: RecordPaymentRequest,
  ): Promise<void> {
    await request<unknown>(
      config,
      `/api/v1/clinics/${clinicId}/billing/invoices/${invoiceId}/payments`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function getLaborForecast(
    clinicId: string,
    forecastDays?: number,
  ): Promise<LaborForecastSummary> {
    const qs = forecastDays !== undefined ? `?forecastDays=${String(forecastDays)}` : "";
    return request<LaborForecastSummary>(
      config,
      `/api/v1/clinics/${clinicId}/forecast/labor${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getMaterialsForecast(
    clinicId: string,
    forecastDays?: number,
  ): Promise<SkuDemandProjection[]> {
    const qs = forecastDays !== undefined ? `?forecastDays=${String(forecastDays)}` : "";
    return request<SkuDemandProjection[]>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/forecast/materials${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getMaterialsAlerts(
    clinicId: string,
    forecastDays?: number,
  ): Promise<MaterialShortfallAlert[]> {
    const qs = forecastDays !== undefined ? `?forecastDays=${String(forecastDays)}` : "";
    return request<MaterialShortfallAlert[]>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/forecast/alerts${qs}`,
      {},
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

  // ── Analytics ──────────────────────────────────────────────────────────────

  async function getAnalyticsDashboard(
    clinicId: string,
    filters: DashboardFilters = {},
  ): Promise<DashboardKpis> {
    const qs =
      filters.periodDays !== undefined ? `?periodDays=${String(filters.periodDays)}` : "";
    return request<DashboardKpis>(
      config,
      `/api/v1/clinics/${clinicId}/analytics/dashboard${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getAllClinicsAnalyticsDashboard(
    filters: DashboardFilters = {},
  ): Promise<AllClinicsDashboardKpis> {
    const qs =
      filters.periodDays !== undefined ? `?periodDays=${String(filters.periodDays)}` : "";
    return request<AllClinicsDashboardKpis>(
      config,
      `/api/v1/analytics/dashboard/all${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getAnalyticsRevenue(
    clinicId: string,
    filters: RevenueReportFilters = {},
  ): Promise<RevenueReport> {
    const qs = filters.months !== undefined ? `?months=${String(filters.months)}` : "";
    return request<RevenueReport>(
      config,
      `/api/v1/clinics/${clinicId}/analytics/revenue${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getAnalyticsInventory(clinicId: string): Promise<InventoryReport> {
    return request<InventoryReport>(
      config,
      `/api/v1/clinics/${clinicId}/analytics/inventory`,
      {},
      requireAccessToken(),
    );
  }

  async function getAnalyticsStaff(
    clinicId: string,
    filters: StaffReportFilters = {},
  ): Promise<StaffReport> {
    const qs =
      filters.periodDays !== undefined ? `?periodDays=${String(filters.periodDays)}` : "";
    return request<StaffReport>(
      config,
      `/api/v1/clinics/${clinicId}/analytics/staff${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function listAuditEvents(
    clinicId: string,
    filters: AuditEventsFilters = {},
  ): Promise<AuditEventsPage> {
    const query = new URLSearchParams();
    if (filters.entityType) query.set("entityType", filters.entityType);
    if (filters.actorId) query.set("actorId", filters.actorId);
    if (filters.entityId) query.set("entityId", filters.entityId);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    if (filters.offset !== undefined) query.set("offset", String(filters.offset));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<AuditEventsPage>(
      config,
      `/api/v1/clinics/${clinicId}/analytics/audit-events${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getAuditEvent(clinicId: string, eventId: string): Promise<AuditEvent> {
    return request<AuditEvent>(
      config,
      `/api/v1/clinics/${clinicId}/analytics/audit-events/${eventId}`,
      {},
      requireAccessToken(),
    );
  }

  // ── Timesheets ──────────────────────────────────────────────────────────────

  /**
   * Lists the authenticated user's own timesheet entries.
   * Calls GET /clinics/:clinicId/timesheets/me — available to all roles.
   * clinical_staff must use this instead of listTimesheets (which is manager-only).
   */
  async function listMyTimesheets(
    clinicId: string,
    filters: TimesheetFilters = {},
  ): Promise<TimesheetEntry[]> {
    const query = new URLSearchParams();
    if (filters.shiftDate) query.set("shiftDate", filters.shiftDate);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.payrollType) query.set("payrollType", filters.payrollType);
    if (filters.attendanceStatus) query.set("attendanceStatus", filters.attendanceStatus);
    if (filters.timesheetStatus) query.set("timesheetStatus", filters.timesheetStatus);
    if (filters.pendingApprovalOnly) query.set("pendingApprovalOnly", "true");
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<TimesheetEntry[]>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets/me${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function listTimesheets(
    clinicId: string,
    filters: TimesheetFilters = {},
  ): Promise<TimesheetEntry[]> {
    const query = new URLSearchParams();
    if (filters.shiftDate) query.set("shiftDate", filters.shiftDate);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.payrollType) query.set("payrollType", filters.payrollType);
    if (filters.attendanceStatus) query.set("attendanceStatus", filters.attendanceStatus);
    if (filters.timesheetStatus) query.set("timesheetStatus", filters.timesheetStatus);
    if (filters.pendingApprovalOnly) query.set("pendingApprovalOnly", "true");
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<TimesheetEntry[]>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function clockIn(
    clinicId: string,
    body: ClockInRequest,
  ): Promise<TimesheetEntry> {
    return request<TimesheetEntry>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets/clock-in`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function clockOut(
    clinicId: string,
    timesheetId: string,
    body: ClockOutRequest,
  ): Promise<TimesheetEntry> {
    return request<TimesheetEntry>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets/${timesheetId}/clock-out`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function createManualTimesheetEntry(
    clinicId: string,
    body: CreateManualTimesheetRequest,
  ): Promise<TimesheetEntry> {
    return request<TimesheetEntry>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function approveTimesheet(
    clinicId: string,
    timesheetId: string,
    body: ApproveTimesheetRequest = {},
  ): Promise<TimesheetEntry> {
    return request<TimesheetEntry>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets/${timesheetId}/approve`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function rejectTimesheet(
    clinicId: string,
    timesheetId: string,
    body: RejectTimesheetRequest,
  ): Promise<TimesheetEntry> {
    return request<TimesheetEntry>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets/${timesheetId}/reject`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function verifyCommissionAttendance(
    clinicId: string,
    timesheetId: string,
    body: VerifyAttendanceRequest,
  ): Promise<TimesheetEntry> {
    return request<TimesheetEntry>(
      config,
      `/api/v1/clinics/${clinicId}/timesheets/${timesheetId}/verify-attendance`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  // ── Leave ───────────────────────────────────────────────────────────────────

  async function listLeave(
    clinicId: string,
    filters: LeaveFilters = {},
  ): Promise<LeaveRequest[]> {
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.leaveType) query.set("leaveType", filters.leaveType);
    if (filters.status) query.set("status", filters.status);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<LeaveRequest[]>(
      config,
      `/api/v1/clinics/${clinicId}/leave${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function listMyLeave(
    clinicId: string,
    filters: LeaveFilters = {},
  ): Promise<LeaveRequest[]> {
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.leaveType) query.set("leaveType", filters.leaveType);
    if (filters.status) query.set("status", filters.status);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<LeaveRequest[]>(
      config,
      `/api/v1/clinics/${clinicId}/leave/me${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function createLeaveRequest(
    clinicId: string,
    body: CreateLeaveRequest,
  ): Promise<LeaveRequest> {
    return request<LeaveRequest>(
      config,
      `/api/v1/clinics/${clinicId}/leave`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function approveLeave(
    clinicId: string,
    leaveId: string,
    body: ApproveLeaveRequest = {},
  ): Promise<LeaveRequest> {
    return request<LeaveRequest>(
      config,
      `/api/v1/clinics/${clinicId}/leave/${leaveId}/approve`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function rejectLeave(
    clinicId: string,
    leaveId: string,
    body: RejectLeaveRequest,
  ): Promise<LeaveRequest> {
    return request<LeaveRequest>(
      config,
      `/api/v1/clinics/${clinicId}/leave/${leaveId}/reject`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function withdrawLeave(
    clinicId: string,
    leaveId: string,
  ): Promise<LeaveRequest> {
    return request<LeaveRequest>(
      config,
      `/api/v1/clinics/${clinicId}/leave/${leaveId}/withdraw`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  // ── Suppliers ────────────────────────────────────────────────────────────────

  async function listSuppliers(params?: ListSuppliersParams): Promise<Supplier[]> {
    const query = new URLSearchParams();
    if (params?.active !== undefined) query.set("active", String(params.active));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<Supplier[]>(config, `/api/v1/suppliers${qs}`, {}, requireAccessToken());
  }

  async function getSupplier(supplierId: string): Promise<Supplier> {
    return request<Supplier>(
      config,
      `/api/v1/suppliers/${encodeURIComponent(supplierId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createSupplier(body: CreateSupplierRequest): Promise<Supplier> {
    return request<Supplier>(
      config,
      "/api/v1/suppliers",
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateSupplier(
    supplierId: string,
    body: UpdateSupplierRequest,
  ): Promise<Supplier> {
    return request<Supplier>(
      config,
      `/api/v1/suppliers/${encodeURIComponent(supplierId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function getSupplierCatalogue(supplierId: string): Promise<SupplierProduct[]> {
    return request<SupplierProduct[]>(
      config,
      `/api/v1/suppliers/${encodeURIComponent(supplierId)}/catalogue`,
      {},
      requireAccessToken(),
    );
  }

  async function previewSupplierCatalogueImport(
    supplierId: string,
    file: File,
  ): Promise<CatalogueImportPreviewResult> {
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const accessToken = requireAccessToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(
      `${baseUrl}/api/v1/suppliers/${encodeURIComponent(supplierId)}/catalogue/import/preview`,
      {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as ApiErrorBody | null;
      throw new Error(errorBody?.error.message ?? `Request failed (${String(response.status)})`);
    }

    const envelope = await response.json() as { data: CatalogueImportPreviewResult };
    return envelope.data;
  }

  async function confirmSupplierCatalogueImport(
    supplierId: string,
    file: File,
  ): Promise<CatalogueImportConfirmResult> {
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const accessToken = requireAccessToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(
      `${baseUrl}/api/v1/suppliers/${encodeURIComponent(supplierId)}/catalogue/import/confirm`,
      {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as ApiErrorBody | null;
      throw new Error(errorBody?.error.message ?? `Request failed (${String(response.status)})`);
    }

    const envelope = await response.json() as { data: CatalogueImportConfirmResult };
    return envelope.data;
  }

  /**
   * Imports a curated Master Product Library file (CSV/XLSX) into
   * master_catalog_items. Catalogue-only: never creates stock movements.
   * When clinicId is provided, newly created products are also provisioned
   * into that clinic's inventory at quantityOnHand 0 so they appear in the
   * clinic's Products list immediately.
   */
  async function importMasterProductLibrary(
    file: File,
    clinicId?: string,
  ): Promise<MasterProductImportResult> {
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const accessToken = requireAccessToken();
    const formData = new FormData();
    formData.append("file", file);
    if (clinicId) {
      formData.append("clinicId", clinicId);
    }

    const response = await fetch(`${baseUrl}/api/v1/master-products/import`, {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as ApiErrorBody | null;
      throw new Error(errorBody?.error.message ?? `Request failed (${String(response.status)})`);
    }

    const envelope = await response.json() as { data: MasterProductImportResult };
    return envelope.data;
  }

  // ── Master Products management (CRUD/list) ──────────────────────────────────

  /**
   * Lists master products with search/category/status filters and pagination.
   * The backend returns { data: [...], pagination: { total, limit, offset } }
   * which differs from the standard { data: T } envelope, so we parse the
   * response body manually to capture both the items array and pagination.
   */
  async function listMasterProducts(
    params: ListMasterProductsParams = {},
  ): Promise<MasterProductsPage> {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.category) query.set("category", params.category);
    if (params.status) query.set("status", params.status);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : "";
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const accessToken = requireAccessToken();

    const response = await fetch(`${baseUrl}/api/v1/master-products${qs}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as ApiErrorBody | null;
      const message = errorBody?.error.message ?? `Request failed (${String(response.status)})`;
      throw new Error(message);
    }

    type RawEnvelope = {
      data: MasterProduct[];
      pagination: { total: number; limit: number; offset: number };
    };
    const envelope = await response.json() as RawEnvelope;
    return {
      items: envelope.data,
      total: envelope.pagination.total,
      limit: envelope.pagination.limit,
      offset: envelope.pagination.offset,
    };
  }

  async function getMasterProduct(id: string): Promise<MasterProduct> {
    return request<MasterProduct>(
      config,
      `/api/v1/master-products/${encodeURIComponent(id)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createMasterProduct(body: CreateMasterProductRequest): Promise<MasterProduct> {
    return request<MasterProduct>(
      config,
      "/api/v1/master-products",
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateMasterProduct(
    id: string,
    body: UpdateMasterProductRequest,
  ): Promise<MasterProduct> {
    return request<MasterProduct>(
      config,
      `/api/v1/master-products/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function archiveMasterProduct(id: string): Promise<MasterProduct> {
    return request<MasterProduct>(
      config,
      `/api/v1/master-products/${encodeURIComponent(id)}/archive`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function reactivateMasterProduct(id: string): Promise<MasterProduct> {
    return request<MasterProduct>(
      config,
      `/api/v1/master-products/${encodeURIComponent(id)}/reactivate`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function suggestMasterProductMatch(
    body: SuggestMatchesRequest,
  ): Promise<SuggestMatchesResult> {
    return request<SuggestMatchesResult>(
      config,
      "/api/v1/master-products/match",
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function confirmMasterProductMatch(
    body: ConfirmMatchRequest,
  ): Promise<ConfirmedSupplierProductMapping> {
    return request<ConfirmedSupplierProductMapping>(
      config,
      "/api/v1/master-products/match/confirm",
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function confirmReviewedSupplierCatalogueImport(
    supplierId: string,
    body: ReviewedCatalogueImportRequest,
  ): Promise<ReviewedCatalogueImportResult> {
    return request<ReviewedCatalogueImportResult>(
      config,
      `/api/v1/suppliers/${encodeURIComponent(supplierId)}/catalogue/import/confirm-reviewed`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function listClinicSupplierInvoices(
    clinicId: string,
    params?: ListSupplierInvoicesParams,
  ): Promise<SupplierInvoice[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.supplierId) query.set("supplierId", params.supplierId);
    if (params?.from) query.set("from", params.from);
    if (params?.to) query.set("to", params.to);
    if (params?.page !== undefined) query.set("page", String(params.page));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<SupplierInvoice[]>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices${qs}`,
      {},
      requireAccessToken(),
    );
  }

  /**
   * Uploads a supplier invoice file (PDF/PNG/JPEG) via multipart/form-data.
   * Triggers OCR extraction server-side and returns the created draft invoice
   * with extracted line items.  Uses a 2-minute timeout as OCR can be slow.
   */
  async function uploadSupplierInvoice(
    clinicId: string,
    file: File,
  ): Promise<UploadAndExtractResult> {
    const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    const accessToken = requireAccessToken();
    const formData = new FormData();
    formData.append("file", file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, 120_000);

    let response: Response;
    try {
      response = await fetch(
        `${baseUrl}/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/upload`,
        {
          method: "POST",
          body: formData,
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: "include",
          signal: controller.signal,
        },
      );
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
        throw new Error(
          "Upload timed out. The file may be large or the connection is slow. Please try again.",
        );
      }
      throw fetchErr;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response
        .json()
        .catch(() => null) as {
          error?: {
            code?: string;
            message?: string;
            requestId?: string;
            details?: Array<{ path?: string; message?: string }>;
          };
        } | null;
      const errorCode = errorBody?.error?.code;
      const requestId = errorBody?.error?.requestId;
      const details = errorBody?.error?.details
        ?.map((detail) => detail.message)
        .filter(Boolean)
        .join("; ");
      const baseMessage =
        errorBody?.error?.message ?? (response.statusText || `HTTP ${String(response.status)}`);
      const messageParts = [
        baseMessage,
        errorCode ? `Code: ${errorCode}` : null,
        details ? `Details: ${details}` : null,
        requestId ? `Request ID: ${requestId}` : null,
      ].filter(Boolean);
      const message = `Upload failed (${String(response.status)}): ${messageParts.join(" · ")}`;
      throw new Error(message);
    }

    const envelope = await response.json() as { data: UploadAndExtractResult };
    return envelope.data;
  }

  async function getSupplierInvoice(
    clinicId: string,
    invoiceId: string,
  ): Promise<{ invoice: SupplierInvoice; lines: SupplierInvoiceLine[] }> {
    return request<{ invoice: SupplierInvoice; lines: SupplierInvoiceLine[] }>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/${encodeURIComponent(invoiceId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function updateSupplierInvoice(
    clinicId: string,
    invoiceId: string,
    body: UpdateSupplierInvoiceRequest,
  ): Promise<{
    invoice: SupplierInvoice;
    duplicateInvoiceNumberWarning: {
      existingInvoiceId: string;
      existingStatus: SupplierInvoiceStatus;
    } | null;
  }> {
    return request<{
      invoice: SupplierInvoice;
      duplicateInvoiceNumberWarning: {
        existingInvoiceId: string;
        existingStatus: SupplierInvoiceStatus;
      } | null;
    }>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/${encodeURIComponent(invoiceId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateSupplierInvoiceLine(
    clinicId: string,
    invoiceId: string,
    lineId: string,
    body: UpdateSupplierInvoiceLineRequest,
  ): Promise<SupplierInvoiceLine> {
    return request<SupplierInvoiceLine>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/${encodeURIComponent(invoiceId)}/lines/${encodeURIComponent(lineId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function confirmSupplierInvoice(
    clinicId: string,
    invoiceId: string,
    body: ConfirmImportRequest = {},
  ): Promise<ConfirmImportResult> {
    return request<ConfirmImportResult>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/${encodeURIComponent(invoiceId)}/confirm`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function cancelSupplierInvoiceImport(
    clinicId: string,
    invoiceId: string,
  ): Promise<SupplierInvoice> {
    return request<SupplierInvoice>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/${encodeURIComponent(invoiceId)}/cancel`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function voidSupplierInvoice(
    clinicId: string,
    invoiceId: string,
  ): Promise<SupplierInvoice> {
    return request<SupplierInvoice>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/${encodeURIComponent(invoiceId)}/void`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  /**
   * POST /:invoiceId/receive
   * Records physical stock receipt against a confirmed invoice.
   * Returns 409 INVOICE_ALREADY_RECEIVED if the invoice was already received.
   */
  async function receiveSupplierInvoice(
    clinicId: string,
    invoiceId: string,
    body: ReceiveInvoiceRequest,
  ): Promise<ReceiveInvoiceResult> {
    return request<ReceiveInvoiceResult>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-invoices/${encodeURIComponent(invoiceId)}/receive`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  // ── Supplier Intelligence ──────────────────────────────────────────────────

  async function getSupplierIntelligence(
    clinicId: string,
  ): Promise<SupplierIntelligenceResult> {
    return request<SupplierIntelligenceResult>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-intelligence`,
      {},
      requireAccessToken(),
    );
  }

  // ── Organisations (Sprint 4A — owner_admin only) ───────────────────────────

  /**
   * GET /organisations
   * Returns all organisations ordered by name.
   * owner_admin only — throws 403 for other roles.
   */
  async function listOrganisations(): Promise<OrganisationData[]> {
    return request<OrganisationData[]>(
      config,
      "/api/v1/organisations",
      {},
      requireAccessToken(),
    );
  }

  /**
   * GET /organisations/:organisationId
   * Returns a single organisation by UUID.
   * owner_admin only.
   */
  async function getOrganisation(
    organisationId: string,
  ): Promise<OrganisationData> {
    return request<OrganisationData>(
      config,
      `/api/v1/organisations/${encodeURIComponent(organisationId)}`,
      {},
      requireAccessToken(),
    );
  }

  /**
   * POST /organisations
   * Creates a new organisation.
   * owner_admin only.
   */
  async function createOrganisation(
    data: CreateOrganisationData,
  ): Promise<OrganisationData> {
    return request<OrganisationData>(
      config,
      "/api/v1/organisations",
      { method: "POST", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  /**
   * PATCH /organisations/:organisationId
   * Partial update — only supplied fields are written.
   * owner_admin only.
   */
  async function updateOrganisation(
    organisationId: string,
    data: UpdateOrganisationData,
  ): Promise<OrganisationData> {
    return request<OrganisationData>(
      config,
      `/api/v1/organisations/${encodeURIComponent(organisationId)}`,
      { method: "PATCH", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  // ── Legal Entities (Sprint 4B — owner_admin only) ──────────────────────────

  /**
   * GET /organisations/:organisationId/legal-entities
   * Returns all legal entities for the given organisation.
   * owner_admin only.
   */
  async function listLegalEntities(
    organisationId: string,
  ): Promise<LegalEntityData[]> {
    return request<LegalEntityData[]>(
      config,
      `/api/v1/organisations/${encodeURIComponent(organisationId)}/legal-entities`,
      {},
      requireAccessToken(),
    );
  }

  /**
   * GET /legal-entities/:id
   * Returns a single legal entity by UUID.
   * owner_admin only.
   */
  async function getLegalEntity(id: string): Promise<LegalEntityData> {
    return request<LegalEntityData>(
      config,
      `/api/v1/legal-entities/${encodeURIComponent(id)}`,
      {},
      requireAccessToken(),
    );
  }

  /**
   * POST /organisations/:organisationId/legal-entities
   * Creates a new legal entity under the given organisation.
   * owner_admin only.
   */
  async function createLegalEntity(
    organisationId: string,
    data: CreateLegalEntityData,
  ): Promise<LegalEntityData> {
    return request<LegalEntityData>(
      config,
      `/api/v1/organisations/${encodeURIComponent(organisationId)}/legal-entities`,
      { method: "POST", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  /**
   * PATCH /legal-entities/:id
   * Partial update — only supplied fields are written.
   * owner_admin only.
   */
  async function updateLegalEntity(
    id: string,
    data: UpdateLegalEntityData,
  ): Promise<LegalEntityData> {
    return request<LegalEntityData>(
      config,
      `/api/v1/legal-entities/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  // ── Supplier Relationships (Sprint 4D) ───────────────────────────────────────

  async function listSupplierRelationships(
    clinicId: string,
    params?: ListSupplierRelationshipsParams,
  ): Promise<SupplierRelationship[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<SupplierRelationship[]>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-relationships${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getSupplierRelationship(
    relationshipId: string,
  ): Promise<SupplierRelationship> {
    return request<SupplierRelationship>(
      config,
      `/api/v1/supplier-relationships/${encodeURIComponent(relationshipId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createSupplierRelationship(
    clinicId: string,
    body: CreateSupplierRelationshipRequest,
  ): Promise<SupplierRelationship> {
    return request<SupplierRelationship>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/supplier-relationships`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateSupplierRelationship(
    relationshipId: string,
    body: UpdateSupplierRelationshipRequest,
  ): Promise<SupplierRelationship> {
    return request<SupplierRelationship>(
      config,
      `/api/v1/supplier-relationships/${encodeURIComponent(relationshipId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function deactivateSupplierRelationship(
    relationshipId: string,
  ): Promise<SupplierRelationship> {
    return request<SupplierRelationship>(
      config,
      `/api/v1/supplier-relationships/${encodeURIComponent(relationshipId)}/deactivate`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  // ── Procurement Policies — Sprint 4E ────────────────────────────────────────

  async function listProcurementPolicies(
    clinicId: string,
    params?: ListProcurementPoliciesParams,
  ): Promise<ProcurementPolicy[]> {
    const qs = params?.status
      ? `?status=${encodeURIComponent(params.status)}`
      : "";
    return request<ProcurementPolicy[]>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/procurement-policies${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getProcurementPolicy(policyId: string): Promise<ProcurementPolicy> {
    return request<ProcurementPolicy>(
      config,
      `/api/v1/procurement-policies/${encodeURIComponent(policyId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createProcurementPolicy(
    clinicId: string,
    data: CreateProcurementPolicyRequest,
  ): Promise<ProcurementPolicy> {
    return request<ProcurementPolicy>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/procurement-policies`,
      { method: "POST", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  async function updateProcurementPolicy(
    policyId: string,
    data: UpdateProcurementPolicyRequest,
  ): Promise<ProcurementPolicy> {
    return request<ProcurementPolicy>(
      config,
      `/api/v1/procurement-policies/${encodeURIComponent(policyId)}`,
      { method: "PATCH", body: JSON.stringify(data) },
      requireAccessToken(),
    );
  }

  async function deactivateProcurementPolicy(
    policyId: string,
  ): Promise<ProcurementPolicy> {
    return request<ProcurementPolicy>(
      config,
      `/api/v1/procurement-policies/${encodeURIComponent(policyId)}/deactivate`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  // ── Supplier Contracts (Sprint 4F) ───────────────────────────────────────────

  async function listSupplierContracts(
    relationshipId: string,
    params?: ListSupplierContractsParams,
  ): Promise<SupplierContract[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<SupplierContract[]>(
      config,
      `/api/v1/supplier-relationships/${encodeURIComponent(relationshipId)}/contracts${qs}`,
      {},
      requireAccessToken(),
    );
  }

  async function getSupplierContract(contractId: string): Promise<SupplierContract> {
    return request<SupplierContract>(
      config,
      `/api/v1/supplier-contracts/${encodeURIComponent(contractId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createSupplierContract(
    relationshipId: string,
    body: CreateSupplierContractRequest,
  ): Promise<SupplierContract> {
    return request<SupplierContract>(
      config,
      `/api/v1/supplier-relationships/${encodeURIComponent(relationshipId)}/contracts`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateSupplierContract(
    contractId: string,
    body: UpdateSupplierContractRequest,
  ): Promise<SupplierContract> {
    return request<SupplierContract>(
      config,
      `/api/v1/supplier-contracts/${encodeURIComponent(contractId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function expireSupplierContract(contractId: string): Promise<SupplierContract> {
    return request<SupplierContract>(
      config,
      `/api/v1/supplier-contracts/${encodeURIComponent(contractId)}/expire`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function terminateSupplierContract(
    contractId: string,
  ): Promise<SupplierContract> {
    return request<SupplierContract>(
      config,
      `/api/v1/supplier-contracts/${encodeURIComponent(contractId)}/terminate`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  // ── Supplier Contract Prices (Sprint 4G) ─────────────────────────────────────

  async function listSupplierContractPrices(
    contractId: string,
  ): Promise<SupplierContractPrice[]> {
    return request<SupplierContractPrice[]>(
      config,
      `/api/v1/supplier-contracts/${encodeURIComponent(contractId)}/prices`,
      {},
      requireAccessToken(),
    );
  }

  async function getSupplierContractPrice(
    priceId: string,
  ): Promise<SupplierContractPrice> {
    return request<SupplierContractPrice>(
      config,
      `/api/v1/supplier-contract-prices/${encodeURIComponent(priceId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createSupplierContractPrice(
    contractId: string,
    body: CreateSupplierContractPriceRequest,
  ): Promise<SupplierContractPrice> {
    return request<SupplierContractPrice>(
      config,
      `/api/v1/supplier-contracts/${encodeURIComponent(contractId)}/prices`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateSupplierContractPrice(
    priceId: string,
    body: UpdateSupplierContractPriceRequest,
  ): Promise<SupplierContractPrice> {
    return request<SupplierContractPrice>(
      config,
      `/api/v1/supplier-contract-prices/${encodeURIComponent(priceId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function expireSupplierContractPrice(
    priceId: string,
  ): Promise<SupplierContractPrice> {
    return request<SupplierContractPrice>(
      config,
      `/api/v1/supplier-contract-prices/${encodeURIComponent(priceId)}/expire`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  // ── Stocktake ──────────────────────────────────────────────────────────────

  async function listStocktakeSessions(
    clinicId: string,
    filters?: StocktakeSessionFilters,
  ): Promise<StocktakeSessionsPage> {
    const params = new URLSearchParams();
    if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters?.offset !== undefined) params.set("offset", String(filters.offset));
    if (filters?.status) params.set("status", filters.status);
    const qs = params.toString();
    return request<StocktakeSessionsPage>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes${qs ? `?${qs}` : ""}`,
      {},
      requireAccessToken(),
    );
  }

  async function getStocktakeSession(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeSession> {
    return request<StocktakeSession>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes/${encodeURIComponent(sessionId)}`,
      {},
      requireAccessToken(),
    );
  }

  async function createStocktakeSession(
    clinicId: string,
    body: CreateStocktakeSessionRequest,
  ): Promise<StocktakeSession> {
    return request<StocktakeSession>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes`,
      { method: "POST", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function updateStocktakeSession(
    clinicId: string,
    sessionId: string,
    body: UpdateStocktakeSessionRequest,
  ): Promise<StocktakeSession> {
    return request<StocktakeSession>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes/${encodeURIComponent(sessionId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  async function startStocktakeSession(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeSession> {
    return request<StocktakeSession>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes/${encodeURIComponent(sessionId)}/start`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function cancelStocktakeSession(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeSession> {
    return request<StocktakeSession>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes/${encodeURIComponent(sessionId)}/cancel`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function completeStocktakeSession(
    clinicId: string,
    sessionId: string,
  ): Promise<CompleteStocktakeResponse> {
    return request<CompleteStocktakeResponse>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes/${encodeURIComponent(sessionId)}/complete`,
      { method: "POST" },
      requireAccessToken(),
    );
  }

  async function listStocktakeLines(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeLine[]> {
    return request<StocktakeLine[]>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes/${encodeURIComponent(sessionId)}/lines`,
      {},
      requireAccessToken(),
    );
  }

  async function updateStocktakeLine(
    clinicId: string,
    sessionId: string,
    lineId: string,
    body: UpdateStocktakeLineRequest,
  ): Promise<StocktakeLine> {
    return request<StocktakeLine>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/stocktakes/${encodeURIComponent(sessionId)}/lines/${encodeURIComponent(lineId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      requireAccessToken(),
    );
  }

  return {
    getHealth,
    login,
    verifyMfa,
    setupMfa,
    confirmMfa,
    refresh,
    logout,
    getMe,
    listInventory,
    getInventoryItem,
    adjustInventory,
    receiveInventory,
    listAdjustments,
    handleScan,
    createProduct,
    listUsers,
    createUser,
    updateUser,
    changePassword,
    resetUserPassword,
    listPurchaseOrders,
    getPurchaseOrderDetail,
    createPurchaseOrder,
    updatePurchaseOrder,
    submitPurchaseOrder,
    cancelPurchaseOrder,
    addPoLine,
    updatePoLine,
    removePoLine,
    receivePurchaseOrder,
    exportPurchaseOrdersCsv,
    listRoster,
    getMyShifts,
    createShift,
    updateShift,
    cancelShift,
    getLaborForecast,
    getMaterialsForecast,
    getMaterialsAlerts,
    listClinics,
    createClinic,
    getClinic,
    updateClinicSettings,
    listInvoices,
    getInvoice,
    recordPayment,
    getAnalyticsDashboard,
    getAllClinicsAnalyticsDashboard,
    getAnalyticsRevenue,
    getAnalyticsInventory,
    getAnalyticsStaff,
    listAuditEvents,
    getAuditEvent,
    listMyTimesheets,
    listTimesheets,
    clockIn,
    clockOut,
    createManualTimesheetEntry,
    approveTimesheet,
    rejectTimesheet,
    verifyCommissionAttendance,
    listLeave,
    listMyLeave,
    createLeaveRequest,
    approveLeave,
    rejectLeave,
    withdrawLeave,
    listSuppliers,
    getSupplier,
    createSupplier,
    updateSupplier,
    getSupplierCatalogue,
    previewSupplierCatalogueImport,
    confirmSupplierCatalogueImport,
    confirmReviewedSupplierCatalogueImport,
    importMasterProductLibrary,
    listMasterProducts,
    getMasterProduct,
    createMasterProduct,
    updateMasterProduct,
    archiveMasterProduct,
    reactivateMasterProduct,
    suggestMasterProductMatch,
    confirmMasterProductMatch,
    listClinicSupplierInvoices,
    uploadSupplierInvoice,
    getSupplierInvoice,
    updateSupplierInvoice,
    updateSupplierInvoiceLine,
    confirmSupplierInvoice,
    cancelSupplierInvoiceImport,
    voidSupplierInvoice,
    receiveSupplierInvoice,
    getSupplierIntelligence,
    listOrganisations,
    getOrganisation,
    createOrganisation,
    updateOrganisation,
    listLegalEntities,
    getLegalEntity,
    createLegalEntity,
    updateLegalEntity,
    listSupplierRelationships,
    getSupplierRelationship,
    createSupplierRelationship,
    updateSupplierRelationship,
    deactivateSupplierRelationship,
    listProcurementPolicies,
    getProcurementPolicy,
    createProcurementPolicy,
    updateProcurementPolicy,
    deactivateProcurementPolicy,
    listSupplierContracts,
    getSupplierContract,
    createSupplierContract,
    updateSupplierContract,
    expireSupplierContract,
    terminateSupplierContract,
    listSupplierContractPrices,
    getSupplierContractPrice,
    createSupplierContractPrice,
    updateSupplierContractPrice,
    expireSupplierContractPrice,
    listStocktakeSessions,
    getStocktakeSession,
    createStocktakeSession,
    updateStocktakeSession,
    startStocktakeSession,
    cancelStocktakeSession,
    completeStocktakeSession,
    listStocktakeLines,
    updateStocktakeLine,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
