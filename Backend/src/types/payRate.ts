/**
 * payRate.ts — Staff Pay Rate types for V1 hourly labour costing.
 *
 * Monetary values are stored and passed as INTEGER AUD CENTS.
 * The API layer converts to/from fractional dollars.
 */

export type EmploymentType = "full_time" | "part_time" | "casual";

export const EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "part_time", "casual"];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  casual: "Casual",
};

export type StaffPayRate = {
  id: string;
  staffUserId: string;
  /** Base hourly rate in AUD cents (integer). Divide by 100 for display. */
  baseHourlyRateCents: number;
  employmentType: EmploymentType;
  /** Null for casual staff or when not applicable. */
  contractedWeeklyHours: number | null;
  /** Employer SG super rate as a percentage, e.g. 12.00. Stored per-row for historical accuracy. */
  superRatePercent: number;
  /** Inclusive start date: this rate applies from this date (YYYY-MM-DD). */
  effectiveFrom: string;
  /** Exclusive end date: this rate applies UNTIL (not including) this date. Null = currently active. */
  effectiveTo: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePayRateInput = {
  staffUserId: string;
  baseHourlyRateCents: number;
  employmentType: EmploymentType;
  contractedWeeklyHours?: number | null;
  superRatePercent: number;
  effectiveFrom: string; // YYYY-MM-DD
  createdByUserId: string;
};

/** Returned by findEffectiveRate — includes a flag for the forecast service. */
export type EffectivePayRate = StaffPayRate & {
  /** Always true — the forecast service uses this to distinguish from the fallback. */
  isConfigured: true;
};
