import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "../src/pages/HomePage.js";
import type { AllClinicsDashboardKpis, DashboardKpis } from "../src/types/analytics.js";
import type { InventoryItem, PurchaseOrderLine } from "../src/types/inventory.js";
import type { LeaveRequest, TimesheetEntry } from "../src/types/payroll.js";
import type { SupplierInvoice } from "../src/types/supplier.js";
import {
  createAdminUser,
  createManagerUser,
  createStaffUser,
  TEST_CLINIC_B_ID,
  TEST_CLINIC_B_NAME,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
} from "./helpers/auth.js";
import type { AuthTestState } from "./helpers/mockUseAuth.js";

const {
  authTestState,
  selectedClinicState,
  mockGetAnalyticsDashboard,
  mockGetAllClinicsAnalyticsDashboard,
  mockListInventory,
  mockListSupplierInvoices,
  mockListPurchaseOrders,
  mockListTimesheets,
  mockListMyTimesheets,
  mockListLeave,
  mockListMyLeave,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  const selectedClinicState: {
    selectedClinic: { id: string; name: string };
    selectedDashboardScope:
      | { type: "all_clinics" }
      | { type: "clinic"; clinic: { id: string; name: string } };
    availableClinics: { id: string; name: string }[];
  } = {
    selectedClinic: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Verve Dental Clinic A",
    },
    selectedDashboardScope: {
      type: "clinic" as const,
      clinic: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Verve Dental Clinic A",
      },
    },
    availableClinics: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Verve Dental Clinic A",
      },
    ],
  };

  return {
    authTestState,
    selectedClinicState,
    mockGetAnalyticsDashboard: vi.fn(),
    mockGetAllClinicsAnalyticsDashboard: vi.fn(),
    mockListInventory: vi.fn(),
    mockListSupplierInvoices: vi.fn(),
    mockListPurchaseOrders: vi.fn(),
    mockListTimesheets: vi.fn(),
    mockListMyTimesheets: vi.fn(),
    mockListLeave: vi.fn(),
    mockListMyLeave: vi.fn(),
  };
});

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({
    user: authTestState.user,
    isLoading: authTestState.isLoading,
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../src/clinic/useSelectedClinic.js", () => ({
  useSelectedClinic: () => ({
    selectedClinic: selectedClinicState.selectedClinic,
    selectedDashboardScope: selectedClinicState.selectedDashboardScope,
    availableClinics: selectedClinicState.availableClinics,
    canSwitchClinics: selectedClinicState.availableClinics.length > 1,
    canSelectAllClinics: false,
    isLoadingClinics: false,
    clinicError: null,
    hasClinicProvider: true,
    setSelectedClinicId: vi.fn(),
    setDashboardScope: vi.fn(),
  }),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    getAnalyticsDashboard: mockGetAnalyticsDashboard,
    getAllClinicsAnalyticsDashboard: mockGetAllClinicsAnalyticsDashboard,
    listInventory: mockListInventory,
    listClinicSupplierInvoices: mockListSupplierInvoices,
    listPurchaseOrders: mockListPurchaseOrders,
    listTimesheets: mockListTimesheets,
    listMyTimesheets: mockListMyTimesheets,
    listLeave: mockListLeave,
    listMyLeave: mockListMyLeave,
  }),
}));

const dashboardKpis: DashboardKpis = {
  clinicId: TEST_CLINIC_ID,
  periodDays: 7,
  periodFrom: "2026-06-20",
  periodTo: "2026-06-26",
  revenue: {
    totalRevenueCents: 125000,
    paidCents: 100000,
    outstandingCents: 25000,
    overdueCount: 1,
    invoiceCount: 12,
  },
  inventory: {
    totalItems: 2,
    lowStockCount: 1,
    adjustmentsCount: 4,
    topConsumedSkus: [{ sku: "VRV-GLV-001", name: "Gloves", unitsConsumed: 10 }],
  },
  roster: {
    shiftsScheduled: 8,
    shiftsCompleted: 6,
    shiftsCancelled: 0,
    uniqueStaffCount: 4,
  },
};

const allClinicsDashboardKpis: AllClinicsDashboardKpis = {
  scope: "all_clinics",
  periodDays: 7,
  periodFrom: "2026-06-20",
  periodTo: "2026-06-26",
  clinicCount: 2,
  revenue: {
    totalRevenueCents: 250000,
    paidCents: 200000,
    outstandingCents: 50000,
    overdueCount: 2,
    invoiceCount: 24,
  },
  inventory: {
    totalItems: 4,
    lowStockCount: 2,
    adjustmentsCount: 8,
    topConsumedSkus: [{ sku: "VRV-GLV-001", name: "Gloves", unitsConsumed: 20 }],
  },
  roster: {
    shiftsScheduled: 16,
    shiftsCompleted: 12,
    shiftsCancelled: 0,
    uniqueStaffCount: 8,
  },
  clinics: [
    {
      clinicId: TEST_CLINIC_ID,
      clinicName: TEST_CLINIC_NAME,
      kpis: dashboardKpis,
    },
    {
      clinicId: TEST_CLINIC_B_ID,
      clinicName: TEST_CLINIC_B_NAME,
      kpis: {
        ...dashboardKpis,
        clinicId: TEST_CLINIC_B_ID,
        revenue: {
          ...dashboardKpis.revenue,
          totalRevenueCents: 125000,
        },
      },
    },
  ],
};

const inventoryItems: InventoryItem[] = [
  {
    id: "item-1",
    clinicId: TEST_CLINIC_ID,
    masterCatalogItemId: "master-1",
    masterSku: "VRV-GLV-001",
    name: "Nitrile Gloves",
    category: "PPE",
    unitOfMeasure: "box",
    quantityOnHand: 2,
    reorderPoint: 5,
    unitCostCents: 1500,
    unitCostOverrideCents: null,
    supplierPreference: "DentalCo",
    isBelowReorderPoint: true,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

const pendingInvoice: SupplierInvoice = {
  id: "supplier-invoice-1",
  clinicId: TEST_CLINIC_ID,
  supplierId: "supplier-1",
  supplierNameRaw: "DentalCo",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-06-25",
  dueDate: null,
  status: "pending_review",
  subtotalCents: 10000,
  taxCents: 1000,
  totalCents: 11000,
  currency: "AUD",
  ocrProvider: "claude",
  ocrConfidence: 92,
  originalFilename: "invoice.pdf",
  fileMimeType: "application/pdf",
  importedByUserId: "user-1",
  importedByEmail: "admin@clinic.test",
  confirmedByUserId: null,
  confirmedAt: null,
  voidedByUserId: null,
  voidedAt: null,
  notes: null,
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
};

const draftPurchaseOrderLine: PurchaseOrderLine = {
  id: "po-line-1",
  draftPurchaseOrderId: "draft-po-1",
  masterCatalogItemId: "master-1",
  masterSku: "VRV-GLV-001",
  itemName: "Nitrile Gloves",
  clinicInventoryItemId: "item-1",
  quantity: 4,
  reason: "below_reorder_point",
  orderStatus: "draft",
  createdAt: "2026-06-25T00:00:00.000Z",
};

const submittedTimesheet: TimesheetEntry = {
  id: "timesheet-1",
  payrollType: "hourly_auto",
  staffUserId: "staff-1",
  staffEmail: "staff@clinic.test",
  clinicId: TEST_CLINIC_ID,
  rosteredClinicId: TEST_CLINIC_ID,
  rosteredClinicName: TEST_CLINIC_NAME,
  rosterEntryId: "roster-1",
  shiftDate: "2026-06-26",
  shiftStartAt: "2026-06-26T09:00:00.000Z",
  shiftEndAt: "2026-06-26T17:00:00.000Z",
  attendanceStatus: "present",
  clockInAt: "2026-06-26T09:00:00.000Z",
  clockOutAt: null,
  breakDurationMinutes: null,
  totalHoursWorked: null,
  ordinaryHours: null,
  overtime15xHours: null,
  overtime2xHours: null,
  overtimeCustomHours: null,
  timesheetStatus: "submitted",
  approvedByUserId: null,
  approvedAt: null,
  approvalNotes: null,
  commissionNote: null,
  generatedBy: "system_auto",
  createdAt: "2026-06-26T09:00:00.000Z",
  updatedAt: "2026-06-26T09:00:00.000Z",
};

const pendingLeave: LeaveRequest = {
  id: "leave-1",
  staffUserId: "staff-1",
  staffEmail: "staff@clinic.test",
  clinicId: TEST_CLINIC_ID,
  leaveType: "annual",
  startDate: "2026-07-01",
  endDate: "2026-07-02",
  totalDays: 2,
  reason: "Holiday",
  status: "pending",
  reviewedByUserId: null,
  reviewedAt: null,
  reviewNotes: null,
  createdAt: "2026-06-26T00:00:00.000Z",
  updatedAt: "2026-06-26T00:00:00.000Z",
};

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage role dashboards", () => {
  beforeEach(() => {
    authTestState.user = createManagerUser();
    authTestState.isLoading = false;
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    };
    selectedClinicState.availableClinics = [{ id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME }];

    mockGetAnalyticsDashboard.mockReset();
    mockGetAllClinicsAnalyticsDashboard.mockReset();
    mockListInventory.mockReset();
    mockListSupplierInvoices.mockReset();
    mockListPurchaseOrders.mockReset();
    mockListTimesheets.mockReset();
    mockListMyTimesheets.mockReset();
    mockListLeave.mockReset();
    mockListMyLeave.mockReset();

    mockGetAnalyticsDashboard.mockResolvedValue(dashboardKpis);
    mockGetAllClinicsAnalyticsDashboard.mockResolvedValue(allClinicsDashboardKpis);
    mockListInventory.mockResolvedValue(inventoryItems);
    mockListSupplierInvoices.mockResolvedValue([pendingInvoice]);
    mockListPurchaseOrders.mockResolvedValue([draftPurchaseOrderLine]);
    mockListTimesheets.mockResolvedValue([submittedTimesheet]);
    mockListMyTimesheets.mockResolvedValue([submittedTimesheet]);
    mockListLeave.mockResolvedValue([pendingLeave]);
    mockListMyLeave.mockResolvedValue([pendingLeave]);
  });

  it("renders the owner admin executive dashboard", async () => {
    authTestState.user = createAdminUser();
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    };
    selectedClinicState.availableClinics = [
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ];

    renderHomePage();

    expect(
      await screen.findByRole("heading", {
        name: `Executive overview for ${TEST_CLINIC_B_NAME}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Executive KPIs")).toBeInTheDocument();
    expect(screen.getByText("Recent Operational Activity")).toBeInTheDocument();
    expect(screen.getByText("Clinic Scope")).toBeInTheDocument();
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_B_ID);
    expect(mockGetAnalyticsDashboard).toHaveBeenCalledWith(TEST_CLINIC_B_ID, {
      periodDays: 7,
    });
  });

  it("renders the owner admin all-clinics dashboard scope", async () => {
    authTestState.user = createAdminUser();
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
    selectedClinicState.selectedDashboardScope = { type: "all_clinics" };
    selectedClinicState.availableClinics = [
      { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    ];

    renderHomePage();

    expect(
      await screen.findByRole("heading", {
        name: "Executive overview for All Clinics",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Organisation-wide operational data across all active clinics."))
      .toBeInTheDocument();
    expect(screen.getByText("Clinic Breakdown")).toBeInTheDocument();
    expect(mockGetAllClinicsAnalyticsDashboard).toHaveBeenCalledWith({ periodDays: 7 });
    expect(mockGetAnalyticsDashboard).not.toHaveBeenCalled();
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_ID);
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_B_ID);
  });

  it("renders the group practice manager action dashboard", async () => {
    authTestState.user = createManagerUser();

    renderHomePage();

    expect(
      await screen.findByRole("heading", {
        name: `What ${TEST_CLINIC_NAME} needs today`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Today’s Operational Summary")).toBeInTheDocument();
    expect(screen.getByText("Clinic Alerts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Receive Stock" })).toHaveAttribute(
      "href",
      "/inventory?mode=receive",
    );
    expect(screen.getByRole("link", { name: "Low Stock 1 items requiring stock review" }))
      .toHaveAttribute("href", "/inventory?focus=low-stock");
    expect(screen.queryByText("Executive KPIs")).not.toBeInTheDocument();
  });

  it("renders a simple clinical staff dashboard without executive or procurement sections", async () => {
    authTestState.user = createStaffUser();

    renderHomePage();

    expect(
      await screen.findByRole("heading", {
        name: `Your day at ${TEST_CLINIC_NAME}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Today’s Work")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clock In / Out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scan Inventory" })).toBeInTheDocument();
    expect(screen.queryByText("Executive KPIs")).not.toBeInTheDocument();
    expect(screen.queryByText("Purchase Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending OCR")).not.toBeInTheDocument();
  });

  it("keeps selected clinic context compatible with dashboard loading", async () => {
    authTestState.user = createManagerUser();
    selectedClinicState.selectedClinic = { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME };
    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: { id: TEST_CLINIC_B_ID, name: TEST_CLINIC_B_NAME },
    };

    renderHomePage();

    expect(
      await screen.findByRole("heading", {
        name: `What ${TEST_CLINIC_B_NAME} needs today`,
      }),
    ).toBeInTheDocument();
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_B_ID);
    expect(mockListSupplierInvoices).toHaveBeenCalledWith(TEST_CLINIC_B_ID, {
      status: "pending_review",
      limit: 50,
    });
    expect(mockListPurchaseOrders).toHaveBeenCalledWith(TEST_CLINIC_B_ID);
  });
});
