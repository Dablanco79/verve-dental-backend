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
import type { LaborForecastSummary } from "../types/forecast.js";
import type {
  MaterialShortfallAlert,
  SkuDemandProjection,
} from "../types/materialsForecast.js";
import type { ClinicData, CreateClinicData, UpdateClinicData } from "../types/clinic.js";
import type { Invoice, InvoiceFilters, RecordPaymentRequest } from "../types/billing.js";
import type {
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
  CreateSupplierRequest,
  ListSupplierInvoicesParams,
  ListSuppliersParams,
  Supplier,
  SupplierInvoice,
  SupplierProduct,
} from "../types/supplier.js";

type ApiEnvelope<T> = { data: T };

/** Default request timeout in milliseconds (30 s). */
const REQUEST_TIMEOUT_MS = 30_000;

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
      data: InventoryItem[];
      pagination: { total: number; limit: number; offset: number };
    };
    const envelope = await response.json() as RawEnvelope;
    return {
      items: envelope.data as unknown as AdjustmentsPage["items"],
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

  async function submitPurchaseOrder(
    clinicId: string,
    poId: string,
  ): Promise<{ purchaseOrder: { id: string; status: string }; lines: PurchaseOrderLine[] }> {
    return request<{ purchaseOrder: { id: string; status: string }; lines: PurchaseOrderLine[] }>(
      config,
      `/api/v1/clinics/${encodeURIComponent(clinicId)}/purchase-orders/${encodeURIComponent(poId)}/submit`,
      {
        method: "PATCH",
        body: JSON.stringify({}),
      },
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

  async function getSupplierCatalogue(supplierId: string): Promise<SupplierProduct[]> {
    return request<SupplierProduct[]>(
      config,
      `/api/v1/suppliers/${encodeURIComponent(supplierId)}/catalogue`,
      {},
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
    listAdjustments,
    handleScan,
    createProduct,
    listUsers,
    createUser,
    updateUser,
    changePassword,
    resetUserPassword,
    listPurchaseOrders,
    submitPurchaseOrder,
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
    getSupplierCatalogue,
    listClinicSupplierInvoices,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
