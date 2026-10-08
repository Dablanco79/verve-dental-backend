import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "../src/pages/HomePage.js";
import type { AllClinicsDashboardKpis, DashboardKpis } from "../src/types/analytics.js";
import type { GroupLaborCostAnalysis, LaborCostAnalysis } from "../src/types/forecast.js";
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
  mockGetLaborForecast,
  mockGetGroupLaborForecast,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  const selectedClinicState: {
    selectedClinic: { id: string; name: string } | null;
    selectedDashboardScope:
      | { type: "all_clinics" }
      | { type: "clinic"; clinic: { id: string; name: string } }
      | null;
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
    mockGetLaborForecast: vi.fn(),
    mockGetGroupLaborForecast: vi.fn(),
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
    getLaborForecast: mockGetLaborForecast,
    getGroupLaborForecast: mockGetGroupLaborForecast,
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
  supplierName: null,
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
  receivedAt: null,
  receivedByUserId: null,
  receivedReference: null,
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
  receivedQuantity: 0,
  outstandingQuantity: 4,
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
  clockInNote: null,
  clockOutNote: null,
  generatedBy: "system_auto",
  clockInLocation: null,
  clockOutLocation: null,
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
  cancelledByUserId: null,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: "2026-06-26T00:00:00.000Z",
  updatedAt: "2026-06-26T00:00:00.000Z",
};

const CHELTENHAM_ID = "33333333-3333-4333-8333-333333333333";
const HEATHMONT_ID = "44444444-4444-4444-8444-444444444444";

function clinicLaborForecast(clinicId: string, totalCost: number): LaborCostAnalysis {
  return {
    clinicId,
    dateRange: {
      from: "2026-10-06",
      to: "2026-10-19",
      timezone: "Australia/Melbourne",
    },
    historical: null,
    futureForecast: {
      totalHours: 10,
      baseCost: totalCost,
      superCost: 0,
      totalCost,
      anyStaffUsingFallback: false,
      breakdownByShiftType: [],
    },
    planningEstimate: {
      approvedCost: 0,
      pendingCost: 0,
      futureCost: totalCost,
      totalCost,
    },
    staffBreakdown: [],
    dataQuality: {
      hasIncompleteTimesheets: false,
      hasMissingTimesheets: false,
      hasRejectedTimesheets: false,
      hasRequiresAmendment: false,
    },
  };
}

function groupLaborForecast(totalCost: number): GroupLaborCostAnalysis {
  return {
    scope: "all_clinics",
    dateRange: { from: "2026-10-06", to: "2026-10-19" },
    totals: {
      totalHours: 30,
      approvedCost: 0,
      pendingCost: 0,
      futureCost: totalCost,
      totalCost,
      missingCount: 0,
    },
    clinics: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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
    mockGetLaborForecast.mockReset();
    mockGetGroupLaborForecast.mockReset();

    mockGetAnalyticsDashboard.mockResolvedValue(dashboardKpis);
    mockGetAllClinicsAnalyticsDashboard.mockResolvedValue(allClinicsDashboardKpis);
    mockListInventory.mockResolvedValue(inventoryItems);
    mockListSupplierInvoices.mockResolvedValue([pendingInvoice]);
    mockListPurchaseOrders.mockResolvedValue([draftPurchaseOrderLine]);
    mockListTimesheets.mockResolvedValue([submittedTimesheet]);
    mockListMyTimesheets.mockResolvedValue([submittedTimesheet]);
    mockListLeave.mockResolvedValue([pendingLeave]);
    mockListMyLeave.mockResolvedValue([pendingLeave]);
    mockGetLaborForecast.mockRejectedValue(new Error("not mocked"));
    mockGetGroupLaborForecast.mockRejectedValue(new Error("not mocked"));
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
        name: /good (morning|afternoon|evening), admin/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Today's Operational Brief")).toBeInTheDocument();
    expect(screen.getByText("Clinic Operational Health")).toBeInTheDocument();
    expect(screen.getByText("Spend vs Budget")).toBeInTheDocument();
    expect(screen.getByText("Action Centre")).toBeInTheDocument();
    expect(screen.getByText("AI Insights")).toBeInTheDocument();
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
        name: /good (morning|afternoon|evening), admin/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Clinic opening status not connected")).toBeInTheDocument();
    expect(screen.getByText("Clinic Operational Health")).toBeInTheDocument();
    expect(screen.getAllByText(TEST_CLINIC_NAME).length).toBeGreaterThan(0);
    expect(screen.getAllByText(TEST_CLINIC_B_NAME).length).toBeGreaterThan(0);
    expect(mockGetAllClinicsAnalyticsDashboard).toHaveBeenCalledWith({ periodDays: 7 });
    expect(mockGetAnalyticsDashboard).not.toHaveBeenCalled();
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_ID);
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_B_ID);
  });

  it("renders the group practice manager action dashboard", async () => {
    authTestState.user = createManagerUser();

    renderHomePage();

    // New H1: greeting + manager name (Stage 5 PM hub)
    expect(
      await screen.findByRole("heading", {
        name: /good (morning|afternoon|evening), manager/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Today's Operational Summary")).toBeInTheDocument();
    expect(screen.getByText("Clinic Alerts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Receive Stock/i })).toHaveAttribute(
      "href",
      "/inventory?mode=receive",
    );
    expect(await screen.findByRole("link", { name: "Low Stock 1 items requiring stock review" }))
      .toHaveAttribute("href", "/inventory?focus=low-stock");
    expect(screen.queryByText("Executive KPIs")).not.toBeInTheDocument();
  });

  it("renders a simple clinical staff dashboard without executive or procurement sections", async () => {
    authTestState.user = createStaffUser();

    renderHomePage();

    // H1 greeting replaces the old "Your day at..." heading (Stage 5)
    expect(
      await screen.findByRole("heading", {
        name: /good (morning|afternoon|evening), staff/i,
      }),
    ).toBeInTheDocument();

    // Today's Work section is preserved
    expect(screen.getByText("Today's Work")).toBeInTheDocument();

    // Dominant clock hero card: shows Clock Out because test data has an open timesheet
    expect(screen.getByRole("link", { name: "Clock Out" })).toBeInTheDocument();

    // Secondary quick actions
    expect(screen.getByRole("link", { name: /My Roster/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Scan Inventory/i })).toBeInTheDocument();

    // Executive and procurement sections must NOT be visible to clinical staff
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

    // PM hub H1 greeting still loads (clinic name appears in subtitle tag)
    expect(
      await screen.findByRole("heading", {
        name: /good (morning|afternoon|evening), manager/i,
      }),
    ).toBeInTheDocument();
    // Clinic B name should appear in the pm-hub clinic context tag
    expect(screen.getAllByText(TEST_CLINIC_B_NAME).length).toBeGreaterThan(0);
    expect(mockListInventory).toHaveBeenCalledWith(TEST_CLINIC_B_ID);
    expect(mockListSupplierInvoices).toHaveBeenCalledWith(TEST_CLINIC_B_ID, {
      status: "pending_review",
      limit: 50,
    });
    expect(mockListPurchaseOrders).toHaveBeenCalledWith(TEST_CLINIC_B_ID);
  });

  it("never blanks through All Clinics → Bentleigh → All Clinics → Cheltenham → All Clinics → Heathmont", async () => {
    authTestState.user = createAdminUser();
    const clinics = [
      { id: TEST_CLINIC_ID, name: "Verve Dental - Bentleigh East" },
      { id: CHELTENHAM_ID, name: "Verve Dental - Cheltenham" },
      { id: HEATHMONT_ID, name: "Verve Dental - Heathmont" },
    ];
    selectedClinicState.selectedClinic = clinics[0] as (typeof clinics)[number];
    selectedClinicState.selectedDashboardScope = { type: "all_clinics" };
    selectedClinicState.availableClinics = clinics;

    mockGetGroupLaborForecast.mockResolvedValue(groupLaborForecast(3911.04));
    mockGetLaborForecast.mockImplementation((clinicId: string) => {
      const costs: Record<string, number> = {
        [TEST_CLINIC_ID]: 2882.88,
        [CHELTENHAM_ID]: 1028.16,
        [HEATHMONT_ID]: 0,
      };
      return Promise.resolve(clinicLaborForecast(clinicId, costs[clinicId] ?? 0));
    });

    const view = renderHomePage();

    async function expectHubScope(scopeText: RegExp): Promise<void> {
      expect(
        await screen.findByRole("heading", {
          name: /good (morning|afternoon|evening), admin/i,
        }),
      ).toBeInTheDocument();
      expect(await screen.findByText(scopeText)).toBeInTheDocument();
    }

    function selectAllClinics(): void {
      selectedClinicState.selectedDashboardScope = { type: "all_clinics" };
      view.rerender(<MemoryRouter><HomePage /></MemoryRouter>);
    }

    function selectClinic(clinic: (typeof clinics)[number]): void {
      selectedClinicState.selectedClinic = clinic;
      selectedClinicState.selectedDashboardScope = { type: "clinic", clinic };
      view.rerender(<MemoryRouter><HomePage /></MemoryRouter>);
    }

    await expectHubScope(/3 clinics · group overview/i);
    expect((await screen.findAllByText("$3,911")).length).toBeGreaterThan(0);

    selectClinic(clinics[0] as (typeof clinics)[number]);
    await expectHubScope(/Verve Dental - Bentleigh East · owner overview/i);
    expect((await screen.findAllByText("$2,883")).length).toBeGreaterThan(0);

    selectAllClinics();
    await expectHubScope(/3 clinics · group overview/i);

    selectClinic(clinics[1] as (typeof clinics)[number]);
    await expectHubScope(/Verve Dental - Cheltenham · owner overview/i);
    expect((await screen.findAllByText("$1,028")).length).toBeGreaterThan(0);

    selectAllClinics();
    await expectHubScope(/3 clinics · group overview/i);

    selectClinic(clinics[2] as (typeof clinics)[number]);
    await expectHubScope(/Verve Dental - Heathmont · owner overview/i);
    expect((await screen.findAllByText("$0")).length).toBeGreaterThan(0);

    expect(mockGetLaborForecast).toHaveBeenCalledWith(
      TEST_CLINIC_ID,
      expect.any(Object),
    );
    expect(mockGetLaborForecast).toHaveBeenCalledWith(
      CHELTENHAM_ID,
      expect.any(Object),
    );
    expect(mockGetLaborForecast).toHaveBeenCalledWith(
      HEATHMONT_ID,
      expect.any(Object),
    );
  });

  it("ignores delayed group and clinic responses from previous scopes", async () => {
    authTestState.user = createAdminUser();
    const bentleigh = { id: TEST_CLINIC_ID, name: "Verve Dental - Bentleigh East" };
    selectedClinicState.selectedClinic = bentleigh;
    selectedClinicState.selectedDashboardScope = { type: "all_clinics" };
    selectedClinicState.availableClinics = [bentleigh];

    const delayedGroup = deferred<GroupLaborCostAnalysis>();
    const delayedClinic = deferred<LaborCostAnalysis>();
    mockGetGroupLaborForecast
      .mockImplementationOnce(() => delayedGroup.promise)
      .mockResolvedValueOnce(groupLaborForecast(2222));
    mockGetLaborForecast.mockImplementationOnce(() => delayedClinic.promise);

    const view = renderHomePage();
    await waitFor(() => {
      expect(mockGetGroupLaborForecast).toHaveBeenCalledTimes(1);
    });

    selectedClinicState.selectedDashboardScope = {
      type: "clinic",
      clinic: bentleigh,
    };
    view.rerender(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => {
      expect(mockGetLaborForecast).toHaveBeenCalledTimes(1);
    });

    selectedClinicState.selectedDashboardScope = { type: "all_clinics" };
    view.rerender(<MemoryRouter><HomePage /></MemoryRouter>);
    expect((await screen.findAllByText("$2,222")).length).toBeGreaterThan(0);

    await act(async () => {
      delayedGroup.resolve(groupLaborForecast(9999));
      delayedClinic.resolve(clinicLaborForecast(TEST_CLINIC_ID, 8888));
      await Promise.all([delayedGroup.promise, delayedClinic.promise]);
    });

    expect(screen.queryByText("$9,999")).not.toBeInTheDocument();
    expect(screen.queryByText("$8,888")).not.toBeInTheDocument();
    expect(screen.getAllByText("$2,222").length).toBeGreaterThan(0);
  });

  it("does not request a clinic forecast when the operational clinic ID is undefined", async () => {
    authTestState.user = createAdminUser();
    selectedClinicState.selectedClinic = null;
    selectedClinicState.selectedDashboardScope = null;
    selectedClinicState.availableClinics = [];

    renderHomePage();

    expect(await screen.findByText("Loading clinic context…")).toBeInTheDocument();
    expect(mockGetLaborForecast).not.toHaveBeenCalled();
    expect(mockGetGroupLaborForecast).not.toHaveBeenCalled();
  });
});
