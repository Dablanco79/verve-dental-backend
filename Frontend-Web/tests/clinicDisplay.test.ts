/**
 * clinicDisplay.test.ts
 *
 * Unit tests for the `displayClinicName` utility function.
 *
 * Verifies that:
 *   1. Returns preferredName when set
 *   2. Returns name when preferredName is null
 *   3. Returns name when preferredName is undefined
 *   4. Trims whitespace from preferredName
 *   5. Blank preferredName falls back to name
 *   6. Works correctly for non-Verve-specific naming patterns
 */

import { describe, expect, it } from "vitest";

import { displayClinicName } from "../src/utils/clinicDisplay.js";

describe("displayClinicName", () => {
  it("returns preferredName when set", () => {
    expect(displayClinicName("Verve Dental - Bentleigh East", "Bentleigh East")).toBe(
      "Bentleigh East",
    );
  });

  it("returns name when preferredName is null", () => {
    expect(displayClinicName("Verve Dental - Heathmont", null)).toBe(
      "Verve Dental - Heathmont",
    );
  });

  it("returns name when preferredName is undefined", () => {
    expect(displayClinicName("Verve Dental - Cheltenham")).toBe(
      "Verve Dental - Cheltenham",
    );
  });

  it("trims whitespace from preferredName", () => {
    expect(displayClinicName("Clinic X", "  Fitzroy  ")).toBe("Fitzroy");
  });

  it("blank preferredName (whitespace only) falls back to name", () => {
    expect(displayClinicName("Clinic X", "   ")).toBe("Clinic X");
  });

  it("empty string preferredName falls back to name", () => {
    expect(displayClinicName("Clinic X", "")).toBe("Clinic X");
  });

  it("works for non-Verve naming: returns preferredName when set", () => {
    expect(
      displayClinicName("Northside Medical Centre - Fitzroy", "Fitzroy"),
    ).toBe("Fitzroy");
  });

  it("works for non-Verve naming: returns full name when preferredName absent", () => {
    expect(displayClinicName("Melbourne Specialist Centre - Level 4")).toBe(
      "Melbourne Specialist Centre - Level 4",
    );
  });
});
