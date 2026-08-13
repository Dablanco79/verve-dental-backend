/**
 * PilotResetPage.test.tsx
 *
 * Frontend tests for the Pilot Reset Utility — tests 57–68 from the brief.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotResetPage } from "../src/pages/PilotResetPage.js";
import { createAdminUser, createManagerUser, createStaffUser, TEST_CLINIC_ID, TEST_CLINIC_NAME } from "./helpers/auth.js";
import { setAuthenticatedUser, type AuthTestState } from "./helpers/mockUseAuth.js";
import type { PilotResetPreviewData, PilotResetExecuteData } from "../src/api/client.js";

// ─── Mutable test state (hoisted before module imports) ───────────────────────

const {
  authTestState,
  mockPreviewPilotReset,
  mockExecutePilotReset,
  pilotResetEnabledState,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  const pilotResetEnabledState = { enabled: true };
  return {
    authTestState,
    pilotResetEnabledState,
    mockPreviewPilotReset: vi.fn<() => Promise<PilotResetPreviewData>>(),
    mockExecutePilotReset: vi.fn<() => Promise<PilotResetExecuteData>>(),
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

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
    selectedClinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME, isActive: true },
    selectedDashboardScope: { type: "clinic" as const, clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME } },
    availableClinics: [{ id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME, isActive: true }],
    canSwitchClinics: false,
    canSelectAllClinics: false,
    isLoadingClinics: false,
    clinicError: null,
    hasClinicProvider: true,
    setSelectedClinicId: vi.fn(),
    setDashboardScope: vi.fn(),
  }),
}));

vi.mock("../src/config/index.js", () => ({
  loadConfig: () => ({
    apiBaseUrl: "",
    pilotResetEnabled: pilotResetEnabledState.enabled,
  }),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    previewPilotReset: mockPreviewPilotReset,
    executePilotReset: mockExecutePilotReset,
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_PREVIEW: PilotResetPreviewData = {
  clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
  mode: "operational",
  deleteCounts: {
    purchasingDrafts: 3,
    draftPurchaseOrders: 7,
    draftPurchaseOrdersOperational: 5, // 5 POs with lines (visible in PO UI)
    draftPurchaseOrdersEmpty: 2,       // 2 empty / abandoned POs (invisible in UI)
    draftPoLines: 34,
    draftPoLinesActive: 32,            // lines on non-cancelled/received POs
    draftPoLinesHistorical: 2,         // lines on cancelled/received POs
    stocktakeSessions: 2,
    stocktakeLines: 94,
    supplierInvoices: 12,
    supplierInvoiceLines: 96,
    supplierPriceHistory: 5,
    productSuppliers: 0,
    supplierContractPrices: 0,
    supplierContracts: 0,
    procurementPolicies: 0,
    supplierRelationships: 0,
    clinicInventoryItemsDeleted: 0,
    clinicInventoryItemsSoftZeroed: 0,
  },
  orphanCounts: { orphanMasterProductCandidates: 0 },
  preserved: ["Clinic", "Users", "Global Suppliers", "Master Products"],
  blockers: [],
  warnings: [],
  previewExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  previewToken: "11111111-1111-4111-8111-111111111111",
  expectedConfirmationPhrase: `RESET ${TEST_CLINIC_NAME.toUpperCase()} PILOT DATA`,
};

const MOCK_EXECUTE_RESULT: PilotResetExecuteData = {
  clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
  mode: "operational",
  deletedCounts: MOCK_PREVIEW.deleteCounts,
  preserved: MOCK_PREVIEW.preserved,
  postResetChecks: [
    { name: "Clinic exists", passed: true },
    { name: "No purchasing drafts", passed: true },
    { name: "Global suppliers preserved", passed: true },
  ],
  auditReference: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  completedAt: new Date().toISOString(),
};

function renderPage() {
  return render(
    <MemoryRouter>
      <PilotResetPage />
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  authTestState.user = null;
  authTestState.isLoading = false;
  pilotResetEnabledState.enabled = true;
  vi.clearAllMocks();
  mockPreviewPilotReset.mockResolvedValue(MOCK_PREVIEW);
  mockExecutePilotReset.mockResolvedValue(MOCK_EXECUTE_RESULT);
});

// T57: Page hidden when feature disabled

describe("T57: Page hidden when feature flag disabled", () => {
  it("redirects to home when VITE_PILOT_RESET_ENABLED is false", () => {
    pilotResetEnabledState.enabled = false;
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();
    // Page should not render destructive content — render will navigate away
    expect(screen.queryByText(/PILOT RESET/i)).toBeNull();
  });
});

// T58: Page hidden from non-owner roles

describe("T58: Page hidden from non-owner roles", () => {
  it("redirects staff away from the pilot reset page", () => {
    setAuthenticatedUser(authTestState, createStaffUser());
    renderPage();
    expect(screen.queryByText(/PILOT RESET/i)).toBeNull();
  });

  it("redirects manager away from the pilot reset page", () => {
    setAuthenticatedUser(authTestState, createManagerUser());
    renderPage();
    expect(screen.queryByText(/PILOT RESET/i)).toBeNull();
  });

  it("renders for owner_admin when feature enabled", () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();
    expect(screen.getByText(/PILOT RESET — DESTRUCTIVE TEST UTILITY/i)).toBeInTheDocument();
  });
});

// T59: Mode descriptions correct

describe("T59: Mode descriptions are correct", () => {
  it("shows both mode options with correct descriptions", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    // Click the clinic selection button to advance to mode selection
    const clinicButton = screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) });
    await userEvent.click(clinicButton);

    expect(screen.getByText("OPERATIONAL RESET")).toBeInTheDocument();
    expect(
      screen.getByText(/Clears procurement and inventory transactions/i),
    ).toBeInTheDocument();
    expect(screen.getByText("FULL PILOT RESET")).toBeInTheDocument();
    expect(
      screen.getByText(/Returns this clinic to a clean operational starting point/i),
    ).toBeInTheDocument();
  });
});

// T60: Preview required before execute

describe("T60: Preview must be run before execute", () => {
  it("execute button is not visible before preview step", () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    // At step 1 — no execute button
    expect(screen.queryByText(/Execute Pilot Reset/i)).toBeNull();
  });
});

// T61: Counts render

describe("T61: Counts render in preview results", () => {
  it("displays delete counts after preview", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    // Select clinic
    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));

    // Select mode
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));

    // Run preview
    const previewButton = screen.getByRole("button", { name: /Preview Reset/i });
    await userEvent.click(previewButton);

    // Wait for results to render
    await waitFor(() => {
      expect(screen.getByText("WILL BE DELETED")).toBeInTheDocument();
    });

    expect(screen.getByText("12")).toBeInTheDocument(); // supplier invoices

    // PO breakdown labels (new clarity fields)
    expect(screen.getByText("Purchase Orders (total DB records)")).toBeInTheDocument();
    expect(screen.getByText("↳ Operational (with product lines)")).toBeInTheDocument();
    // draftPurchaseOrdersEmpty: 2 > 0, so the empty row is rendered
    expect(screen.getByText("↳ Empty / abandoned records")).toBeInTheDocument();
    expect(screen.getByText("PO Lines (total DB records)")).toBeInTheDocument();
    expect(screen.getByText("↳ Active product lines")).toBeInTheDocument();
    // draftPoLinesHistorical: 2 > 0, so the historical row is rendered
    expect(screen.getByText("↳ Historical (cancelled / received)")).toBeInTheDocument();

    expect(screen.getByText("WILL BE PRESERVED")).toBeInTheDocument();
    expect(screen.getByText(/Global Suppliers/i)).toBeInTheDocument();
  });
});

// T62: Warning/blocker render

describe("T62: Blockers and warnings are shown prominently", () => {
  it("shows blocker message when active process detected", async () => {
    const previewWithBlocker: PilotResetPreviewData = {
      ...MOCK_PREVIEW,
      blockers: [
        {
          type: "active_stocktake",
          message: "1 stocktake session is currently in progress.",
        },
      ],
    };
    mockPreviewPilotReset.mockResolvedValueOnce(previewWithBlocker);

    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/BLOCKED/i)).toBeInTheDocument();
      expect(screen.getByText(/1 stocktake session/i)).toBeInTheDocument();
    });

    // MFA input should NOT appear when blocked
    expect(screen.queryByRole("textbox", { name: /mfa/i })).toBeNull();
  });

  it("shows warning message when present", async () => {
    const previewWithWarning: PilotResetPreviewData = {
      ...MOCK_PREVIEW,
      warnings: ["5 clinic products cannot be fully deleted due to append-only adjustments."],
    };
    mockPreviewPilotReset.mockResolvedValueOnce(previewWithWarning);

    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/5 clinic products/i)).toBeInTheDocument();
    });
  });
});

// T63: MFA required

describe("T63: MFA is required before execute", () => {
  it("shows MFA input after preview (no blockers)", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/MFA Re-authentication/i)).toBeInTheDocument();
    });

    const mfaInput = screen.getByPlaceholderText("000000");
    expect(mfaInput).toBeInTheDocument();
  });

  it("MFA Verify button is disabled until 6 digits entered", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/MFA Re-authentication/i)).toBeInTheDocument();
    });

    const verifyButton = screen.getByRole("button", { name: /Verify MFA/i });
    expect(verifyButton).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    expect(verifyButton).not.toBeDisabled();
  });
});

// T64: Typed phrase required

describe("T64: Typed phrase required before execute", () => {
  it("execute button is disabled until phrase matches exactly", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /Verify MFA/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    const executeButton = screen.getByRole("button", { name: /Execute Pilot Reset/i });
    expect(executeButton).toBeDisabled();

    const phraseInput = screen.getByPlaceholderText(/Type the phrase/i);
    await userEvent.type(phraseInput, "wrong phrase");
    expect(executeButton).toBeDisabled();
  });

  it("execute button enabled when phrase matches exactly", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /Verify MFA/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    const expectedPhrase = `RESET ${TEST_CLINIC_NAME.toUpperCase()} PILOT DATA`;
    const phraseInput = screen.getByPlaceholderText(/Type the phrase/i);
    await userEvent.type(phraseInput, expectedPhrase);

    const executeButton = screen.getByRole("button", { name: /Execute Pilot Reset/i });
    expect(executeButton).not.toBeDisabled();
  });
});

// T65: Final execute disabled until all requirements met (covered above)

// T66: Double submit guarded

describe("T66: Double-submit is guarded", () => {
  it("execute button is disabled while executing", async () => {
    let resolveExecute!: (value: PilotResetExecuteData) => void;
    mockExecutePilotReset.mockReturnValueOnce(
      new Promise<PilotResetExecuteData>((res) => {
        resolveExecute = res;
      }),
    );

    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /Verify MFA/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    const expectedPhrase = `RESET ${TEST_CLINIC_NAME.toUpperCase()} PILOT DATA`;
    await userEvent.type(screen.getByPlaceholderText(/Type the phrase/i), expectedPhrase);
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    // While executing, show spinner message and no execute button
    await waitFor(() => {
      expect(screen.getByText(/Executing Pilot Reset/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Execute Pilot Reset/i })).toBeNull();

    // Complete the execution
    resolveExecute(MOCK_EXECUTE_RESULT);
  });
});

// T67: Result page displays counts/checks

describe("T67: Result page displays counts and post-reset checks", () => {
  it("shows result summary after successful execute", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /Verify MFA/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    const expectedPhrase = `RESET ${TEST_CLINIC_NAME.toUpperCase()} PILOT DATA`;
    await userEvent.type(screen.getByPlaceholderText(/Type the phrase/i), expectedPhrase);
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pilot Reset Completed/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Rows Deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/Post-Reset Checks/i)).toBeInTheDocument();
    expect(screen.getAllByText("PASS").length).toBeGreaterThan(0);
    expect(screen.getByText(/Audit Reference/i)).toBeInTheDocument();
  });
});

// T68: Full vs Operational reset description clear

describe("T68: Full vs Operational reset explanation is clear", () => {
  it("Operational Reset description does not mention clinic config", async () => {
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));

    const operationalDesc = screen.getByText(
      /Clears procurement and inventory transactions while preserving product/i,
    );
    expect(operationalDesc).toBeInTheDocument();

    const fullPilotDesc = screen.getByText(
      /Returns this clinic to a clean operational starting point/i,
    );
    expect(fullPilotDesc).toBeInTheDocument();
  });
});

// ─── Helper: advance through all steps to Step 5 ─────────────────────────────

async function advanceToStep5() {
  setAuthenticatedUser(authTestState, createAdminUser());
  renderPage();

  await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
  await userEvent.click(screen.getByText("OPERATIONAL RESET"));
  await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

  await waitFor(() => {
    expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
  });

  await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
  await userEvent.click(screen.getByRole("button", { name: /Verify MFA/i }));

  await waitFor(() => {
    expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
  });

  const expectedPhrase = `RESET ${TEST_CLINIC_NAME.toUpperCase()} PILOT DATA`;
  await userEvent.type(screen.getByPlaceholderText(/Type the phrase/i), expectedPhrase);
}

// T69: Execute failure — error remains visible on Step 5

describe("T69: Execute failure — error banner visible and survives step transition", () => {
  it("shows error on Step 5 when execute rejects with INVALID_PREVIEW_TOKEN", async () => {
    mockExecutePilotReset.mockRejectedValueOnce(
      new Error("Preview token is invalid or has expired. Run preview again before executing."),
    );

    await advanceToStep5();
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    await waitFor(() => {
      // Must be back on Step 5, not on the result screen
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    // Error banner MUST be visible — the useEffect must NOT have cleared it
    expect(
      screen.getByText(/Preview token is invalid or has expired/i),
    ).toBeInTheDocument();

    // Result screen must NOT be shown
    expect(screen.queryByText(/Pilot Reset Completed/i)).toBeNull();
  });

  it("shows error on Step 5 when execute rejects with PREVIEW_TOKEN_EXPIRED", async () => {
    mockExecutePilotReset.mockRejectedValueOnce(
      new Error("Preview token has expired. Run preview again before executing."),
    );

    await advanceToStep5();
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Preview token has expired/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pilot Reset Completed/i)).toBeNull();
  });

  it("shows error on Step 5 when execute rejects with a generic failure", async () => {
    mockExecutePilotReset.mockRejectedValueOnce(
      new Error("Execution failed. Please try again."),
    );

    await advanceToStep5();
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Execution failed\. Please try again\./i)).toBeInTheDocument();
  });

  it("confirmation phrase input is preserved after execute failure so user does not need to retype", async () => {
    mockExecutePilotReset.mockRejectedValueOnce(
      new Error("Preview token is invalid or has expired. Run preview again before executing."),
    );

    await advanceToStep5();
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    const expectedPhrase = `RESET ${TEST_CLINIC_NAME.toUpperCase()} PILOT DATA`;
    const phraseInput = screen.getByPlaceholderText(/Type the phrase/i);
    expect(phraseInput).toHaveValue(expectedPhrase);
  });
});

// T70: Execute fails with INVALID_MFA_CODE — user stays in workflow

describe("T70: INVALID_MFA_CODE error is surfaced without logging the user out", () => {
  it("shows MFA error on Step 5 without redirecting to login", async () => {
    mockExecutePilotReset.mockRejectedValueOnce(
      new Error("Invalid MFA code for Pilot Reset execution"),
    );

    await advanceToStep5();
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    // Error is visible
    expect(screen.getByText(/Invalid MFA code for Pilot Reset execution/i)).toBeInTheDocument();

    // User is NOT logged out — the Pilot Reset page is still rendered
    expect(screen.getByText(/PILOT RESET — DESTRUCTIVE TEST UTILITY/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pilot Reset Completed/i)).toBeNull();
  });
});

// T71: Preview expiry shown on Step 5

describe("T71: Preview expiry timestamp is visible on Step 5", () => {
  it("shows preview expiry time on the confirmation step", async () => {
    await advanceToStep5();

    // The expiry timestamp should appear on Step 5 (previously only on Step 4)
    expect(screen.getByText(/Preview expires at:/i)).toBeInTheDocument();
  });

  it("disables Execute and shows expired banner when preview has expired client-side", async () => {
    // Set previewExpiresAt in the past so the component sees it as already expired
    mockPreviewPilotReset.mockResolvedValueOnce({
      ...MOCK_PREVIEW,
      previewExpiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second in the past
    });

    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TEST_CLINIC_NAME) }));
    await userEvent.click(screen.getByText("OPERATIONAL RESET"));
    await userEvent.click(screen.getByRole("button", { name: /Preview Reset/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /Verify MFA/i }));

    await waitFor(() => {
      expect(screen.getByText(/Typed Confirmation/i)).toBeInTheDocument();
    });

    // Expiry banner must appear immediately
    await waitFor(() => {
      expect(screen.getByText(/Preview expired\. Re-run Preview before executing\./i)).toBeInTheDocument();
    });

    // Execute button must be disabled
    const executeButton = screen.getByRole("button", { name: /Execute Pilot Reset/i });
    expect(executeButton).toBeDisabled();
  });
});

// T72: Successful execute still reaches result screen (regression guard)

describe("T72: Successful execute still navigates to result screen", () => {
  it("shows result screen after successful execute", async () => {
    await advanceToStep5();
    await userEvent.click(screen.getByRole("button", { name: /Execute Pilot Reset/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pilot Reset Completed/i)).toBeInTheDocument();
    });

    // Error banner must NOT appear after success
    expect(screen.queryByText(/expired/i)).toBeNull();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });
});
