import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeavePage } from "../src/pages/LeavePage.js";
import { createManagerUser, createStaffUser, TEST_CLINIC_ID, TEST_CLINIC_NAME } from "./helpers/auth.js";

const {
  state,
  mockSubmit,
  mockPreviewCoverage,
  mockApprove,
  mockFetchManagerCoverage,
  mockListConflicts,
  mockCancelApprovedLeave,
  mockRequestCancellation,
  mockApproveCancellation,
  mockDeclineCancellation,
} = vi.hoisted(() => ({
  state: {
    user: null as ReturnType<typeof createManagerUser> | null,
    requests: [] as Array<Record<string, unknown>>,
    cancellationRequests: [] as Array<Record<string, unknown>>,
  },
  mockSubmit: vi.fn(),
  mockPreviewCoverage: vi.fn(),
  mockApprove: vi.fn(),
  mockFetchManagerCoverage: vi.fn(),
  mockListConflicts: vi.fn(),
  mockCancelApprovedLeave: vi.fn(),
  mockRequestCancellation: vi.fn(),
  mockApproveCancellation: vi.fn(),
  mockDeclineCancellation: vi.fn(),
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
  useLeave: (_clinicId: string | undefined, _role: string | undefined, _filters: unknown, view: string) => {
    const isManagerPersonal =
      view === "personal" && state.user?.role !== "clinical_staff";
    const requests = isManagerPersonal
      ? state.requests.filter((request) => request.staffUserId === state.user?.id)
      : state.requests;
    const cancellationRequests = isManagerPersonal
      ? state.cancellationRequests.filter((request) => request.staffUserId === state.user?.id)
      : state.cancellationRequests;
    return {
    requests,
    cancellationRequests,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    submitRequest: mockSubmit,
    previewCoverageWarning: mockPreviewCoverage,
    approveLeave: mockApprove,
    fetchManagerCoverageWarning: mockFetchManagerCoverage,
    listRosterConflicts: mockListConflicts,
    rejectLeave: vi.fn(),
    cancelApprovedLeave: mockCancelApprovedLeave,
    withdrawLeave: vi.fn(),
    requestCancellation: mockRequestCancellation,
    approveCancellationRequest: mockApproveCancellation,
    declineCancellationRequest: mockDeclineCancellation,
    };
  },
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

function cancellationRequest(status: "pending" | "approved" | "declined" = "pending") {
  return {
    id: "cancel-request-1",
    leaveRequestId: "leave-1",
    clinicId: TEST_CLINIC_ID,
    staffUserId: "staff-1",
    requestedByUserId: "staff-1",
    requestReason: "Plans changed",
    status,
    requestedAt: "2026-10-02T00:00:00Z",
    reviewedByUserId: status === "pending" ? null : "manager-1",
    reviewedAt: status === "pending" ? null : "2026-10-03T00:00:00Z",
    reviewNotes: status === "declined" ? "Coverage unavailable" : null,
    selfReviewExceptionUsed: false,
    createdAt: "2026-10-02T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
  };
}

describe("LeavePage pilot safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requests = [];
    state.cancellationRequests = [];
    mockPreviewCoverage.mockResolvedValue({
      enabled: false,
      status: "disabled",
      overlappingColleagueCount: 0,
      affectedGroups: [],
    });
    mockFetchManagerCoverage.mockResolvedValue({
      enabled: false,
      status: "disabled",
      overlappingColleagueCount: 0,
      affectedGroups: [],
    });
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
    expect(screen.getByText("Calendar days unavailable")).toBeInTheDocument();
    expect(screen.getByText(
      "This is the full absence period, including weekends. Payable leave hours are calculated separately from your ordinary working hours and applicable public holidays.",
    )).toBeInTheDocument();
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

  it("shows the privacy-minimal employee warning before explicit submission", async () => {
    const user = userEvent.setup();
    state.user = createStaffUser();
    mockPreviewCoverage.mockResolvedValue({
      enabled: true,
      status: "ready",
      overlappingColleagueCount: 2,
      affectedGroups: [{
        clinicId: TEST_CLINIC_ID,
        groupId: "group-1",
        groupName: "Clinical team",
      }],
    });
    mockSubmit.mockResolvedValue(leaveRequest());
    renderPage();

    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2026-10-14" } });
    await user.click(screen.getByRole("button", { name: "Submit Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Coverage warning: Another team member in your coverage group has approved leave overlapping your selected dates. You can still submit your request.",
    );
    expect(screen.queryByText(/clinical team/i)).not.toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Submit Anyway" }));
    await waitFor(() => { expect(mockSubmit).toHaveBeenCalledTimes(1); });
  });

  it("shows an advisory failure and still permits explicit submission", async () => {
    const user = userEvent.setup();
    state.user = createStaffUser();
    mockPreviewCoverage.mockRejectedValue(new Error("private database detail"));
    mockSubmit.mockResolvedValue(leaveRequest());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderPage();

    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2026-10-14" } });
    await user.click(screen.getByRole("button", { name: "Submit Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The coverage advisory check could not be completed. You can still submit your request.",
    );
    expect(screen.queryByText(/private database detail/i)).not.toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Submit Anyway" }));
    await waitFor(() => { expect(mockSubmit).toHaveBeenCalledTimes(1); });
    expect(consoleError).toHaveBeenCalledWith(
      "Leave coverage advisory check failed before submission.",
    );
    consoleError.mockRestore();
  });

  it("clears coverage acknowledgment when dates change", async () => {
    const user = userEvent.setup();
    state.user = createStaffUser();
    mockPreviewCoverage.mockResolvedValue({
      enabled: true,
      status: "staff_unassigned",
      overlappingColleagueCount: 0,
      affectedGroups: [],
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2026-10-14" } });
    await user.click(screen.getByRole("button", { name: "Submit Request" }));
    expect(await screen.findByRole("button", { name: "Submit Anyway" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2026-10-15" } });
    expect(screen.getByRole("button", { name: "Submit Request" })).toBeInTheDocument();
    expect(screen.queryByText(/not assigned to a coverage group/i)).not.toBeInTheDocument();
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

  it("requires an explicit manager override for current coverage overlaps", async () => {
    const user = userEvent.setup();
    state.user = createManagerUser();
    state.requests = [leaveRequest()];
    mockFetchManagerCoverage.mockResolvedValue({
      enabled: true,
      status: "ready",
      overlappingColleagueCount: 2,
      affectedGroups: [{
        clinicId: TEST_CLINIC_ID,
        groupId: "group-1",
        groupName: "Clinical team",
      }],
    });
    mockApprove.mockResolvedValue({ leave: leaveRequest("approved"), conflicts: [] });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(`${TEST_CLINIC_NAME} — Clinical team`)).toBeInTheDocument();
    expect(screen.getByText(/2 team members/i)).toBeInTheDocument();
    expect(mockApprove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Approve Anyway" }));
    await waitFor(() => { expect(mockApprove).toHaveBeenCalledWith("leave-1", {}); });
  });

  it("shows a manager advisory failure and still permits explicit approval", async () => {
    const user = userEvent.setup();
    state.user = createManagerUser();
    state.requests = [leaveRequest()];
    mockFetchManagerCoverage.mockRejectedValue(new Error("private database detail"));
    mockApprove.mockResolvedValue({ leave: leaveRequest("approved"), conflicts: [] });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderPage();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /coverage advisory check could not be completed/i,
    );
    expect(screen.queryByText(/private database detail/i)).not.toBeInTheDocument();
    expect(mockApprove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Approve Anyway" }));
    await waitFor(() => { expect(mockApprove).toHaveBeenCalledWith("leave-1", {}); });
    expect(consoleError).toHaveBeenCalledWith(
      "Leave coverage advisory check failed during approval.",
    );
    consoleError.mockRestore();
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
    expect(screen.getAllByText(new RegExp(TEST_CLINIC_NAME)).length).toBeGreaterThanOrEqual(2);
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
    expect(await screen.findByText(
      /no shifts were created, restored, moved or changed/i,
    )).toBeInTheDocument();
  });

  it("shows cancelled status and reason in staff leave history", () => {
    state.user = createStaffUser();
    state.requests = [leaveRequest("cancelled")];
    renderPage();

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Plans changed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("renders a five-day Melbourne calendar range without timezone drift", () => {
    state.user = createStaffUser();
    state.requests = [{
      ...leaveRequest("approved"),
      startDate: "2026-10-12",
      endDate: "2026-10-16",
      totalDays: 5,
    }];
    renderPage();

    expect(screen.getByText("12 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("16 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("requires a reason when staff request cancellation of approved leave", async () => {
    const user = userEvent.setup();
    state.user = createStaffUser();
    state.requests = [leaveRequest("approved")];
    mockRequestCancellation.mockResolvedValue(cancellationRequest());
    renderPage();

    await user.click(screen.getByRole("button", { name: "Request Cancellation" }));
    expect(screen.getByText(/Roster blocks remain until a manager approves/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit Cancellation Request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A cancellation reason is required.");

    await user.type(screen.getByLabelText("Cancellation request reason"), "Plans changed");
    await user.click(screen.getByRole("button", { name: "Submit Cancellation Request" }));
    await waitFor(() => {
      expect(mockRequestCancellation).toHaveBeenCalledWith("leave-1", {
        requestReason: "Plans changed",
      });
    });
  });

  it("keeps approved status and directs managers to the pending cancellation queue", () => {
    state.user = createManagerUser();
    state.requests = [leaveRequest("approved")];
    state.cancellationRequests = [cancellationRequest()];
    renderPage();

    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending Cancellation Requests")).toBeInTheDocument();
    expect(screen.getByText(/Review it in the queue above/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Approved Leave" })).not.toBeInTheDocument();
  });

  it("requires notes to decline a pending cancellation request", async () => {
    const user = userEvent.setup();
    state.user = createManagerUser();
    state.requests = [leaveRequest("approved")];
    state.cancellationRequests = [cancellationRequest()];
    renderPage();

    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(screen.getByRole("button", { name: "Confirm Decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Review notes are required to decline a cancellation request.",
    );
    expect(mockDeclineCancellation).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Cancellation decline notes"), "Coverage unavailable");
    await user.click(screen.getByRole("button", { name: "Confirm Decline" }));
    await waitFor(() => {
      expect(mockDeclineCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cancel-request-1" }),
        { reviewNotes: "Coverage unavailable" },
      );
    });
  });
});
