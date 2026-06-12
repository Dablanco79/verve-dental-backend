/**
 * User management service.
 *
 * RBAC rules:
 *   owner_admin           — can create any role for any clinic; can list any clinic's users
 *   group_practice_manager — can create clinical_staff only for their own clinic; can list their clinic
 *   clinical_staff        — no access
 */

import bcrypt from "bcryptjs";

import type { UserRepository } from "../repositories/userRepository.js";
import type { AuditService } from "./auditService.js";
import type { AuthenticatedUser, PublicUser, UserRecord, UserRole } from "../types/auth.js";
import { AppError } from "../types/errors.js";

const BCRYPT_ROUNDS = 12;

export type CreateUserParams = {
  email: string;
  password: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
};

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    homeClinicId: user.homeClinicId,
    homeClinicName: user.homeClinicName,
  };
}

export function createUserService(
  userRepository: UserRepository,
  audit: AuditService,
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
    });

    audit.logAuthEvent("user.created", {
      userId: caller.id,
      email: caller.email,
      clinicId: caller.homeClinicId,
    });

    return toPublicUser(user);
  }

  return { listUsers, createUser };
}

export type UserService = ReturnType<typeof createUserService>;
