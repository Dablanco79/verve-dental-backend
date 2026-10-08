import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeavePage } from "../src/pages/LeavePage.js";
import { createManagerUser, createStaffUser, TEST_CLINIC_ID, TEST_CLINIC_NAME } from "./helpers/auth.js";

const { state, mockSubmit, mockApprove, mockListConflicts, mockCancelApprovedLeave } = vi.hoisted(() => ({
  state: {
    user: null as ReturnType<typeof createManagerUser> | null,
    requests: [] as Array<Record<string, unknown>>,
  },
  mockSubmit: vi.fn(),
  mockApprove: vi.fn(),
  mockListConflicts: vi.fn(),
  mockCancelApprovedLeave: vi.fn(),
}));

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({ user: state.user, isLoading: false, logout: vi.fn() }),
}));

vi.mock("../src/clinic/useOperationalClinic.js", () => ({
  useOperationalClinic: () => ({
    clinicId: TEST_CLINIC_ID,
    clinicName: TEST_CLINIC_NAME,
    selectedClinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
    isAllClinicsScope: false,
  }),
}));

vi.mock("../src/hooks/useLeave.js", () => ({
  useLeave: () => ({
    requests: state.requests,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    submitRequest: mockSubmit,
    approveLeave: mockApprove,
    listRosterConflicts: mockListConflicts,
    rejectLeave: vi.fn(),
    cancelApprovedLeave: mockCancelApprovedLeave,
    withdrawLeave: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <LeavePage />
    </MemoryRouter>,
  );
}

function leaveRequest(status: "pending" | "approved" | "cancelled" = "pending") {
  return {
    id: "leave-1",
    staffUserId: "staff-1",
    staffEmail: "staff@clinic-a.au",
    clinicId: TEST_CLINIC_ID,
    leaveType: "annual",
    startDate: "2026-10-12",
    endDate: "2026-10-14",
    totalDays: 3,
    reason: "Holiday",
    status,
    reviewedByUserId: status === "pending" ? null : "manager-1",
    reviewedAt: status === "pending" ? null : "2026-10-01T00:00:00Z",
    reviewNotes: status === "pending" ? null : "Approved",
    cancelledByUserId: status === "cancelled" ? "manager-1" : null,
    cancelledAt: status === "cancelled" ? "2026-10-02T00:00:00Z" : null,
    cancellationReason: status === "cancelled" ? "Plans changed" : null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

describe("LeavePage pilot safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requests = [];
  });

  it("submits authoritative dates without client-authored totalDays", async () => {
    const user = userEvent.setup();
    state.user = createStaffUser();
    mockSubmit.mockResolvedValue(leaveRequest());
    renderPage();

    fireEvent.change(screen.getByLabelText("Start Date"), {
      target: { value: "2026-10-12" },
    });
    fireEvent.change(screen.getByLabelText("End Date"), {
      target: { value: "2026-10-14" },
    });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        leaveType: "annual",
        startDate: "2026-10-12",
        endDate: "2026-10-14",
        reason: null,
      });
    });
  });

  it("states approval success, unchanged shifts and required manual action", async () => {
    const user = userEvent.setup();
    state.user = createManagerUser();
    state.requests = [leaveRequest()];
    mockApprove.mockResolvedValue({
      leave: leaveRequest("approved"),
      conflicts: [{
        rosterEntryId: "shift-1",
        staffUserId: "staff-1",
        rosteredClinicId: TEST_CLINIC_ID,
        rosteredClinicName: TEST_CLINIC_NAME,
        shiftStartAt: "2026-10-11T21:00:00Z",
        shiftEndAt: "2026-10-12T06:00:00Z",
        status: "scheduled",
      }],
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Leave was approved.")).toBeInTheDocument();
    expect(screen.getByText(/Existing shifts remain unchanged/)).toBeInTheDocument();
    expect(screen.getByText(/Manual roster action is required/)).toBeInTheDocument();
  });

  it("keeps approved conflicts discoverable from leave history", async () => {
    const user = userEvent.setup();
    state.user = createManagerUser();
    state.requests = [leaveRequest("approved")];
    mockListConflicts.mockResolvedValue([{
      rosterEntryId: "shift-1",
      staffUserId: "staff-1",
      rosteredClinicId: TEST_CLINIC_ID,
      rosteredClinicName: TEST_CLINIC_NAME,
      shiftStartAt: "2026-10-11T21:00:00Z",
      shiftEndAt: "2026-10-12T06:00:00Z",
      status: "scheduled",
    }]);
    renderPage();

    await user.click(screen.getByRole("button", { name: "Review conflicts" }));
    expect(await screen.findByText("1 unresolved")).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(TEST_CLINIC_NAME))).toHaveLength(2);
  });

  it("requires a reason and confirms approved leave cancellation without implying shift restoration", async () => {
    const user = userEvent.setup();
    state.user = createManagerUser();
    state.requests = [leaveRequest("approved")];
    mockCancelApprovedLeave.mockResolvedValue(leaveRequest("cancelled"));
    renderPage();

    await user.click(screen.getByRole("button", { name: "Cancel Approved Leave" }));
    expect(screen.getByText(/does not create, restore, move or change any shifts/i))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm Cancellation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A cancellation reason is required.",
    );
    expect(mockCancelApprovedLeave).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Cancellation reason"), "Employee changed plans");
    await user.click(screen.getByRole("button", { name: "Confirm Cancellation" }));
    await waitFor(() => {
      expect(mockCancelApprovedLeave).toHaveBeenCalledWith("leave-1", {
        cancellationReason: "Employee changed plans",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /no shifts were created, restored, moved or changed/i,
    );
  });

  it("shows cancelled status and reason in staff leave history", () => {
    state.user = createStaffUser();
    state.requests = [leaveRequest("cancelled")];
    renderPage();

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Plans changed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });
});
