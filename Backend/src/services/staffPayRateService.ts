/**
 * staffPayRateService.ts
 *
 * Business logic for staff pay-rate management.
 * Enforces RBAC: only owner_admin can read/write rates (payroll:rates:* permissions).
 * GPM and clinical_staff are denied unless explicitly granted.
 */

import { AppError } from "../types/errors.js";
import type { AuthenticatedUser } from "../types/auth.js";
import type { StaffPayRateRepository } from "../repositories/staffPayRateRepository.js";
import type { StaffPayRate, EffectivePayRate, CreatePayRateInput } from "../types/payRate.js";

export type StaffPayRateService = ReturnType<typeof createStaffPayRateService>;

export function createStaffPayRateService(
  staffPayRateRepository: StaffPayRateRepository,
) {
  function assertReadAccess(caller: AuthenticatedUser): void {
    if (!caller.permissions.includes("payroll:rates:read")) {
      throw new AppError(
        403,
        "INSUFFICIENT_PERMISSIONS",
        "Access to pay rate data requires the payroll:rates:read permission.",
      );
    }
  }

  function assertWriteAccess(caller: AuthenticatedUser): void {
    if (!caller.permissions.includes("payroll:rates:write")) {
      throw new AppError(
        403,
        "INSUFFICIENT_PERMISSIONS",
        "Modifying pay rates requires the payroll:rates:write permission.",
      );
    }
  }

  return {
    async listRates(
      caller: AuthenticatedUser,
      staffUserId: string,
    ): Promise<StaffPayRate[]> {
      assertReadAccess(caller);
      return staffPayRateRepository.listByStaff(staffUserId);
    },

    async findEffectiveRate(
      caller: AuthenticatedUser,
      staffUserId: string,
      date: string,
    ): Promise<EffectivePayRate | null> {
      assertReadAccess(caller);
      return staffPayRateRepository.findEffectiveRate(staffUserId, date);
    },

    async createRate(
      caller: AuthenticatedUser,
      input: Omit<CreatePayRateInput, "createdByUserId">,
    ): Promise<StaffPayRate> {
      assertWriteAccess(caller);
      return staffPayRateRepository.createRate({
        ...input,
        createdByUserId: caller.id,
      });
    },
  };
}
