import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeavePage } from "../src/pages/LeavePage.js";
import {
  createAdminUser,
  createManagerUser,
  createStaffUser,
  TEST_CLINIC_ID,
  TEST_CLINIC_NAME,
} from "./helpers/auth.js";

const { state, useLeaveMock } = vi.hoisted(() => ({
  state: {
    user: null as ReturnType<typeof createManagerUser> | null,
    isAllClinicsScope: false,
  },
  useLeaveMock: vi.fn(),
}));

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({ user: state.user, isLoading: false, logout: vi.fn() }),
}));

vi.mock("../src/clinic/useOperationalClinic.js", () => ({
  useOperationalClinic: () => ({
    clinicId: state.isAllClinicsScope ? undefined : TEST_CLINIC_ID,
    clinicName: state.isAllClinicsScope ? undefined : TEST_CLINIC_NAME,
    selectedClinic: state.isAllClinicsScope
      ? null
      : { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    isAllClinicsScope: state.isAllClinicsScope,
  }),
}));

vi.mock("../src/hooks/useLeave.js", () => ({
  useLeave: (...args: unknown[]): unknown => useLeaveMock(...args) as unknown,
}));

function leave(staffUserId: string, staffEmail: string) {
  return {
    id: `leave-${staffUserId}`,
    staffUserId,
    staffEmail,
    clinicId: TEST_CLINIC_ID,
    leaveType: "annual",
    startDate: "2038-06-10",
    endDate: "2038-06-10",
    totalDays: 1,
    reason: null,
    status: "pending",
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNotes: null,
    cancelledByUserId: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationSelfReviewExceptionUsed: false,
    createdAt: "2038-01-01T00:00:00Z",
    updatedAt: "2038-01-01T00:00:00Z",
  };
}

function result(requests: ReturnType<typeof leave>[] = []) {
  return {
    requests,
    cancellationRequests: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    submitRequest: vi.fn(),
    previewCoverageWarning: vi.fn(),
    approveLeave: vi.fn(),
    fetchManagerCoverageWarning: vi.fn(),
    listRosterConflicts: vi.fn(),
    rejectLeave: vi.fn(),
    cancelApprovedLeave: vi.fn(),
    withdrawLeave: vi.fn(),
    requestCancellation: vi.fn(),
    approveCancellationRequest: vi.fn(),
    declineCancellationRequest: vi.fn(),
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LeavePage />
    </MemoryRouter>,
  );
}

describe("WF08 management personal leave UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isAllClinicsScope = false;
    useLeaveMock.mockImplementation(
      (_clinicId: string | undefined, _role: string | undefined, _filters: unknown, view: string) =>
        view === "personal" ? result() : result(),
    );
  });

  it.each([
    ["GPM", createManagerUser()],
    ["Owner/Admin", createAdminUser()],
  ])("shows My Leave and Manage Leave for %s", (_label, user) => {
    state.user = user;
    useLeaveMock.mockImplementation(
      (_clinicId: string | undefined, _role: string | undefined, _filters: unknown, view: string) =>
        view === "personal"
          ? result([leave(user.id, user.email)])
          : result([
              leave(user.id, user.email),
              leave("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "staff@clinic-a.au"),
            ]),
    );

    renderPage();

    expect(screen.getByRole("heading", { name: "My Leave" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Manage Leave" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Request Leave" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Pending Approval/ })).toBeInTheDocument();
    expect(screen.getByText("Calendar days unavailable")).toBeInTheDocument();
    expect(screen.getByText(
      "This is the full absence period, including weekends. Payable leave hours are calculated separately from your ordinary working hours and applicable public holidays.",
    )).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Calendar days" })).toHaveLength(3);
    expect(screen.queryByRole("columnheader", { name: "Days" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  it("keeps personal leave available in All Clinics and anchors it to home clinic", () => {
    state.user = createAdminUser();
    state.isAllClinicsScope = true;

    renderPage();

    expect(screen.getByRole("heading", { name: "Request Leave" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a clinic to manage leave" }))
      .toBeInTheDocument();
    expect(useLeaveMock).toHaveBeenCalledWith(
      TEST_CLINIC_ID,
      "owner_admin",
      expect.any(Object),
      "personal",
    );
    expect(useLeaveMock).toHaveBeenCalledWith(
      undefined,
      "owner_admin",
      expect.any(Object),
      "manage",
    );
  });

  it("keeps the clinical staff interface unchanged", () => {
    state.user = createStaffUser();

    renderPage();

    expect(screen.getByRole("heading", { name: "Request Leave" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My Requests (Last 90 Days)" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Leave" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Manage Leave" })).not.toBeInTheDocument();
  });

  it("fails closed when the home clinic assignment is missing", () => {
    state.user = createManagerUser({ homeClinicId: "" });

    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "home clinic assignment is missing or invalid",
    );
    expect(screen.queryByRole("heading", { name: "Request Leave" })).not.toBeInTheDocument();
    expect(useLeaveMock).toHaveBeenCalledWith(
      undefined,
      "group_practice_manager",
      expect.any(Object),
      "personal",
    );
  });
});
