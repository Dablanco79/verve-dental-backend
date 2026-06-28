import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useOperationalClinic } from "../src/clinic/useOperationalClinic.js";
import { TEST_CLINIC_ID, TEST_CLINIC_NAME } from "./helpers/auth.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

type MockClinic = { id: string; name: string } | null;
type MockScope =
  | { type: "all_clinics" }
  | { type: "clinic"; clinic: { id: string; name: string } };

interface MockClinicState {
  selectedClinic: MockClinic;
  selectedDashboardScope: MockScope;
}

const mockSelectedClinicState = vi.hoisted((): MockClinicState => ({
  // Values hardcoded here because vi.hoisted() runs before module imports resolve.
  selectedClinic: { id: "11111111-1111-4111-8111-111111111111", name: "Verve Dental Clinic A" },
  selectedDashboardScope: {
    type: "clinic",
    clinic: { id: "11111111-1111-4111-8111-111111111111", name: "Verve Dental Clinic A" },
  },
}));

vi.mock("../src/clinic/useSelectedClinic.js", () => ({
  useSelectedClinic: () => ({
    selectedClinic: mockSelectedClinicState.selectedClinic,
    selectedDashboardScope: mockSelectedClinicState.selectedDashboardScope,
    availableClinics: mockSelectedClinicState.selectedClinic
      ? [mockSelectedClinicState.selectedClinic]
      : [],
    canSwitchClinics: true,
    canSelectAllClinics: true,
    isLoadingClinics: false,
    clinicError: null,
    hasClinicProvider: true,
    setSelectedClinicId: vi.fn(),
    setDashboardScope: vi.fn(),
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useOperationalClinic", () => {
  describe("when a specific clinic is selected", () => {
    it("returns the selected clinic ID", () => {
      mockSelectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
      mockSelectedClinicState.selectedDashboardScope = {
        type: "clinic",
        clinic: { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME },
      };

      const { result } = renderHook(() => useOperationalClinic());

      expect(result.current.clinicId).toBe(TEST_CLINIC_ID);
      expect(result.current.clinicName).toBe(TEST_CLINIC_NAME);
      expect(result.current.isAllClinicsScope).toBe(false);
      expect(result.current.selectedClinic).toEqual({ id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME });
    });
  });

  // NOTE: TEST_CLINIC_ID and TEST_CLINIC_NAME are imported at test-body scope so they
  // are accessible here (unlike vi.hoisted() callbacks which run before imports resolve).

  describe("when All Clinics scope is active", () => {
    it("returns undefined clinicId and isAllClinicsScope true", () => {
      mockSelectedClinicState.selectedDashboardScope = { type: "all_clinics" };

      const { result } = renderHook(() => useOperationalClinic());

      expect(result.current.clinicId).toBeUndefined();
      expect(result.current.clinicName).toBeUndefined();
      expect(result.current.isAllClinicsScope).toBe(true);
      expect(result.current.selectedClinic).toBeNull();
    });

    it("never exposes selectedClinic even if it has a stale value", () => {
      // Provider leaves selectedClinic at the last picked clinic when switching to all_clinics.
      // Pages must use clinicId (undefined) not selectedClinic to detect this case.
      mockSelectedClinicState.selectedClinic = { id: TEST_CLINIC_ID, name: TEST_CLINIC_NAME };
      mockSelectedClinicState.selectedDashboardScope = { type: "all_clinics" };

      const { result } = renderHook(() => useOperationalClinic());

      expect(result.current.clinicId).toBeUndefined();
      expect(result.current.selectedClinic).toBeNull();
    });
  });
});
