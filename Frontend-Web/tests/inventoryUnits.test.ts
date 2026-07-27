/**
 * inventoryUnits.test.ts
 *
 * Finding 3 — "Unit" is missing from Receiving Unit
 *
 * Verifies that:
 *   - RECEIVING_UNIT_OPTIONS includes "Unit" (the central authoritative fix)
 *   - STOCK_UNIT_OPTIONS includes "Unit"
 *   - Both option sets remain consistent: the values used in UoM-sensitive
 *     forms (Master Product, Inventory, Purchase Order, Receiving) are sourced
 *     from this shared constants file.
 *   - "Unit" → "Unit" is representable (stock = receiving = Unit, 1:1)
 *   - Existing receiving units still present (Carton, Box, etc.)
 */

import { describe, it, expect } from "vitest";
import {
  RECEIVING_UNIT_OPTIONS,
  STOCK_UNIT_OPTIONS,
} from "../src/constants/inventoryUnits.js";

describe("RECEIVING_UNIT_OPTIONS — Finding 3: Unit is present", () => {
  it("includes 'Unit' as a valid receiving unit option", () => {
    expect(RECEIVING_UNIT_OPTIONS).toContain("Unit");
  });

  it("includes all pre-existing receiving unit options (regression)", () => {
    const required = ["Box", "Bottle", "Carton", "Pack", "Case", "Pallet"];
    for (const unit of required) {
      expect(RECEIVING_UNIT_OPTIONS).toContain(unit);
    }
  });

  it("does not contain duplicate values", () => {
    const unique = new Set(RECEIVING_UNIT_OPTIONS);
    expect(unique.size).toBe(RECEIVING_UNIT_OPTIONS.length);
  });
});

describe("STOCK_UNIT_OPTIONS — Unit is present (shared UoM source)", () => {
  it("includes 'Unit' as a valid stock unit option", () => {
    expect(STOCK_UNIT_OPTIONS).toContain("Unit");
  });

  it("includes pre-existing stock unit options (regression)", () => {
    const required = ["Box", "Bottle", "Syringe", "Pack"];
    for (const unit of required) {
      expect(STOCK_UNIT_OPTIONS).toContain(unit);
    }
  });
});

describe("Unit → Unit 1:1 representability", () => {
  it("can represent stock_unit=Unit, receiving_unit=Unit (same value in both option lists)", () => {
    // Both option lists must include "Unit" for a 1:1 product to be configurable
    // through all forms (Master Product, Inventory, Purchase Order, Receiving).
    expect(STOCK_UNIT_OPTIONS).toContain("Unit");
    expect(RECEIVING_UNIT_OPTIONS).toContain("Unit");
  });

  it("can represent Carton → Box (multi-unit receiving) — regression", () => {
    expect(RECEIVING_UNIT_OPTIONS).toContain("Carton");
    expect(STOCK_UNIT_OPTIONS).toContain("Box");
  });
});
