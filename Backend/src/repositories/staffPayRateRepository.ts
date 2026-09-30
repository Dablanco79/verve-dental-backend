import { randomUUID } from "node:crypto";
import { AppError } from "../types/errors.js";
import type {
  CreatePayRateInput,
  EffectivePayRate,
  StaffPayRate,
} from "../types/payRate.js";

export interface StaffPayRateRepository {
  /**
   * Returns the staff member's pay rate effective on the given date (YYYY-MM-DD).
   * Uses exclusive effective_to semantics:
   *   effective_from <= date AND (effective_to IS NULL OR effective_to > date)
   * Returns null when no configured rate exists for that date.
   */
  findEffectiveRate(staffUserId: string, date: string): Promise<EffectivePayRate | null>;
  /**
   * Returns all pay rate rows for a staff member, newest first.
   */
  listByStaff(staffUserId: string): Promise<StaffPayRate[]>;
  /**
   * Creates a new pay rate row AND atomically closes the currently-open row
   * (sets its effective_to = newRate.effectiveFrom) if one exists.
   * Throws RATE_OVERLAP (409) if the new effectiveFrom is before or equal to
   * the existing open rate's effectiveFrom.
   */
  createRate(input: CreatePayRateInput): Promise<StaffPayRate>;
}

export function createInMemoryStaffPayRateRepository(): StaffPayRateRepository {
  const rows: StaffPayRate[] = [];

  // Date comparison: YYYY-MM-DD strings compare lexicographically correctly.

  return {
    findEffectiveRate(staffUserId: string, date: string): Promise<EffectivePayRate | null> {
      // Exclusive effective_to: effective_from <= date AND (effective_to IS NULL OR effective_to > date)
      const matches = rows
        .filter(
          (r) =>
            r.staffUserId === staffUserId &&
            r.effectiveFrom <= date &&
            (r.effectiveTo === null || r.effectiveTo > date),
        )
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

      const found = matches[0];
      if (!found) return Promise.resolve(null);
      return Promise.resolve({ ...found, isConfigured: true as const });
    },

    listByStaff(staffUserId: string): Promise<StaffPayRate[]> {
      return Promise.resolve(
        rows
          .filter((r) => r.staffUserId === staffUserId)
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
          .map((r) => ({ ...r })),
      );
    },

    createRate(input: CreatePayRateInput): Promise<StaffPayRate> {
      // Find the currently-open rate for this staff member
      const openRateIdx = rows.findIndex(
        (r) => r.staffUserId === input.staffUserId && r.effectiveTo === null,
      );
      const openRate = openRateIdx >= 0 ? rows[openRateIdx] : null;

      if (openRate) {
        // Prevent new effectiveFrom from being on or before the existing open rate's effectiveFrom
        if (input.effectiveFrom <= openRate.effectiveFrom) {
          return Promise.reject(
            new AppError(
              409,
              "RATE_OVERLAP",
              "New rate's effective-from date must be after the existing active rate's effective-from date.",
            ),
          );
        }
        // Close the existing open rate: effective_to = new rate's effective_from (exclusive)
        rows[openRateIdx] = { ...openRate, effectiveTo: input.effectiveFrom, updatedAt: new Date().toISOString() };
      }

      const now = new Date().toISOString();
      const newRow: StaffPayRate = {
        id: randomUUID(),
        staffUserId: input.staffUserId,
        baseHourlyRateCents: input.baseHourlyRateCents,
        employmentType: input.employmentType,
        contractedWeeklyHours: input.contractedWeeklyHours ?? null,
        superRatePercent: input.superRatePercent,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: null,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(newRow);
      return Promise.resolve({ ...newRow });
    },
  };
}
