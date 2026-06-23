/**
 * User management service.
 *
 * RBAC rules:
 *   owner_admin           — can create any role for any clinic; can list any clinic's users
 *   group_practice_manager — can create clinical_staff only for their own clinic; can list their clinic
 *   clinical_staff        — no access
 */

import bcrypt from "bcryptjs";

import type { UpdateUserFields, UserRepository } from "../repositories/userRepository.js";
import type { AuditService } from "./auditService.js";
import type { AuthService } from "./authService.js";
import type { AuthenticatedUser, PublicUser, UserRecord, UserRole } from "../types/auth.js";
import type { StaffPayrollTrack } from "../types/payroll.js";
import { AppError } from "../types/errors.js";

const BCRYPT_ROUNDS = 12;

export type CreateUserParams = {
  email: string;
  password: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
  firstName: string;
  lastName: string;
  /** Defaults to "First Last" when not supplied. */
  displayName?: string | null;
};

/**
 * Fields that may be updated by PATCH /clinics/:clinicId/users/:userId.
 * All fields are optional — only supplied keys are written.
 *
 * RBAC constraints (enforced in updateUser):
 *   owner_admin           — may update any field for any user.
 *   group_practice_manager — may only update firstName/lastName/displayName/payrollTrack
 *                            for clinical_staff in their own clinic.
 *   clinical_staff        — cannot update any user (blocked at middleware layer).
 */
export type UpdateUserParams = {
  firstName?: string;
  lastName?: string;
  displayName?: string | null;
  payrollTrack?: StaffPayrollTrack;
  role?: UserRole;
  homeClinicId?: string;
  homeClinicName?: string;
};

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    homeClinicId: user.homeClinicId,
    homeClinicName: user.homeClinicName,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    payrollTrack: user.payrollTrack,
  };
}

export function createUserService(
  userRepository: UserRepository,
  audit: AuditService,
  authService: AuthService,
) {
  function assertCanManageClinic(caller: AuthenticatedUser, targetClinicId: string): void {
    if (caller.role === "owner_admin") return;

    if (caller.role === "group_practice_manager") {
      if (caller.homeClinicId !== targetClinicId) {
        throw new AppError(403, "FORBIDDEN", "You can only manage users in your own clinic");
      }
      return;
    }

    throw new AppError(403, "FORBIDDEN", "Insufficient permissions to manage users");
  }

  async function listUsers(
    caller: AuthenticatedUser,
    clinicId: string,
  ): Promise<PublicUser[]> {
    assertCanManageClinic(caller, clinicId);

    const users = await userRepository.listByClinic(clinicId);
    return users.map(toPublicUser);
  }

  async function createUser(
    caller: AuthenticatedUser,
    params: CreateUserParams,
  ): Promise<PublicUser> {
    assertCanManageClinic(caller, params.homeClinicId);

    // Managers can only invite clinical_staff — they cannot escalate privileges.
    if (caller.role === "group_practice_manager" && params.role !== "clinical_staff") {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Practice managers can only create clinical staff accounts",
      );
    }

    const existing = await userRepository.findByEmail(params.email);
    if (existing) {
      throw new AppError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);

    const user = await userRepository.createUser({
      email: params.email,
      passwordHash,
      role: params.role,
      homeClinicId: params.homeClinicId,
      homeClinicName: params.homeClinicName,
      firstName: params.firstName,
      lastName: params.lastName,
      displayName: params.displayName,
    });

    audit.logAuthEvent("user.created", {
      userId: caller.id,
      email: caller.email,
      clinicId: params.homeClinicId,
      resourceId: user.id,
    });

    return toPublicUser(user);
  }

  /**
   * Partial-updates a user's profile fields.
   *
   * RBAC:
   *   owner_admin           — any field, any user, any clinic.
   *   group_practice_manager — firstName/lastName/displayName/payrollTrack only,
   *                            for clinical_staff within their own clinic.
   *   clinical_staff        — denied (blocked by requireRoles middleware before here).
   */
  async function updateUser(
    caller: AuthenticatedUser,
    clinicId: string,
    targetUserId: string,
    params: UpdateUserParams,
  ): Promise<PublicUser> {
    const target = await userRepository.findById(targetUserId);

    if (!target) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    // The target must belong to the clinic in the URL.
    if (target.homeClinicId !== clinicId) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    assertCanManageClinic(caller, clinicId);

    if (caller.role === "group_practice_manager") {
      if (target.role !== "clinical_staff") {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Practice managers can only edit clinical staff accounts",
        );
      }
      if (params.role !== undefined) {
        throw new AppError(403, "FORBIDDEN", "Practice managers cannot change user roles");
      }
      if (params.homeClinicId !== undefined || params.homeClinicName !== undefined) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Practice managers cannot change a user's home clinic",
        );
      }
    }

    const fields: UpdateUserFields = {};
    if (params.firstName !== undefined) fields.firstName = params.firstName;
    if (params.lastName !== undefined) fields.lastName = params.lastName;
    if (params.displayName !== undefined) fields.displayName = params.displayName;
    if (params.payrollTrack !== undefined) fields.payrollTrack = params.payrollTrack;
    if (params.role !== undefined) fields.role = params.role;
    if (params.homeClinicId !== undefined) fields.homeClinicId = params.homeClinicId;
    if (params.homeClinicName !== undefined) fields.homeClinicName = params.homeClinicName;

    const updated = await userRepository.updateUser(targetUserId, fields);

    audit.logAuthEvent("user.updated", {
      userId: caller.id,
      email: caller.email,
      clinicId,
      resourceId: targetUserId,
    });

    return toPublicUser(updated);
  }

  /**
   * Admin/manager resets a target user's password.
   * The caller must manage the target user's clinic. The target user's
   * active sessions are revoked so they must log in again.
   */
  async function resetPassword(
    caller: AuthenticatedUser,
    targetUserId: string,
    newPassword: string,
  ): Promise<void> {
    const target = await userRepository.findById(targetUserId);

    if (!target) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    assertCanManageClinic(caller, target.homeClinicId);

    // Managers cannot reset passwords for admins or other managers.
    if (caller.role === "group_practice_manager" && target.role !== "clinical_staff") {
      throw new AppError(403, "FORBIDDEN", "Practice managers can only reset clinical staff passwords");
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await userRepository.updatePassword(targetUserId, hashedPassword);
    await authService.revokeAllUserTokens(targetUserId);

    audit.logAuthEvent("auth.password.reset", {
      userId: caller.id,
      email: caller.email,
      clinicId: target.homeClinicId,
      resourceId: targetUserId,
    });
  }

  return { listUsers, createUser, updateUser, resetPassword };
}

export type UserService = ReturnType<typeof createUserService>;
