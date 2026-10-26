import type { NextFunction, Request, Response } from "express";

import type { AuthService } from "../services/authService.js";
import type { AuditService } from "../services/auditService.js";
import type { ClinicRepository } from "../repositories/clinicRepository.js";
import type { PermissionRepository } from "../repositories/permissionRepository.js";
import type { UserClinicAssignmentsRepository } from "../repositories/userClinicAssignmentsRepository.js";
import type { UserRole } from "../types/auth.js";
import type { Permission } from "../types/permissions.js";
import { DEFAULT_PERMISSIONS } from "../types/permissions.js";
import { AppError } from "../types/errors.js";

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export function createAuthenticateMiddleware(
  authService: AuthService,
  audit: AuditService,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Short-circuit: req.user is set when the global /clinics/:clinicId
    // middleware already authenticated this request (RLS middleware path).
    if (req.user) {
      next();
      return;
    }

    const token = getBearerToken(req);

    if (!token) {
      audit.logAuthEvent("auth.unauthorized", {
        reason: "missing_token",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
      return;
    }

    let authenticatedUser;
    try {
      authenticatedUser = authService.authenticateAccessToken(token);
    } catch {
      audit.logAuthEvent("auth.unauthorized", {
        reason: "invalid_token",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      next(new AppError(401, "UNAUTHORIZED", "Invalid or expired access token"));
      return;
    }

    // The signed JWT remains the session credential, but every authorization
    // identity field and permission is rebuilt from the current user record.
    void authService
      .rehydrateAuthoritativeUser(authenticatedUser)
      .then((authoritativeUser) => {
        req.user = authoritativeUser;
        next();
      })
      .catch(next);
  };
}

/**
 * Authorizes the actual clinic URL scope and reloads target-clinic grants.
 * This runs before RLS; RLS remains an independent assignment/data boundary.
 */
export function createClinicScopeMiddleware(
  clinics: ClinicRepository,
  permissions: PermissionRepository,
  assignments: UserClinicAssignmentsRepository,
  paramName = "clinicId",
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const rawTargetClinicId = req.params[paramName];
      const targetClinicId = Array.isArray(rawTargetClinicId)
        ? rawTargetClinicId[0]
        : rawTargetClinicId;
      if (!targetClinicId) {
        throw new AppError(400, "VALIDATION_ERROR", `Missing route parameter: ${paramName}`);
      }

      const [targetClinic, homeClinic] = await Promise.all([
        clinics.findById(targetClinicId),
        clinics.findById(req.user.homeClinicId),
      ]);

      if (!targetClinic) {
        throw new AppError(404, "CLINIC_NOT_FOUND", "Clinic not found");
      }
      if (!homeClinic) {
        throw new AppError(403, "TENANT_ACCESS_DENIED", "Home clinic is unavailable");
      }

      // Equality deliberately treats two null organisation IDs as the same
      // legacy/test organisation, while one-null and differing IDs are denied.
      const sameOrganisation = targetClinic.organisationId === homeClinic.organisationId;
      if (!sameOrganisation) {
        throw new AppError(
          403,
          "TENANT_ACCESS_DENIED",
          "You do not have access to this clinic's organisation",
        );
      }

      const isHomeClinic = targetClinic.id === homeClinic.id;
      if (req.user.role === "clinical_staff" && !isHomeClinic) {
        throw new AppError(
          403,
          "TENANT_ACCESS_DENIED",
          "Clinical staff may only access their home clinic",
        );
      }
      if (
        req.user.role === "group_practice_manager" &&
        !isHomeClinic &&
        !(await assignments.hasOperationalAccess(req.user.id, targetClinic.id))
      ) {
        throw new AppError(403, "TENANT_ACCESS_DENIED", "Operational clinic access is required");
      }

      if (req.user.role === "owner_admin") {
        req.user.permissions = [...DEFAULT_PERMISSIONS.owner_admin];
      } else {
        const grants = await permissions.listActiveByUserForClinic(req.user.id, targetClinic.id);
        req.user.permissions = Array.from(
          new Set([...DEFAULT_PERMISSIONS[req.user.role], ...grants]),
        );
      }

      req.authorizedClinicId = targetClinic.id;
      next();
    })().catch(next);
  };
}

/**
 * Middleware for POST /auth/mfa/setup and POST /auth/mfa/confirm.
 *
 * Accepts either:
 *   - A standard Bearer access token (already-enrolled user triggering re-setup)
 *   - An MFA enrollment token issued at login for privileged users who have not
 *     yet enrolled (type "mfa_enrollment")
 *
 * All other token types (mfa_challenge, refresh) are rejected.
 */
export function createMfaSetupMiddleware(
  authService: AuthService,
  audit: AuditService,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.user) {
      next();
      return;
    }

    const token = getBearerToken(req);

    if (!token) {
      audit.logAuthEvent("auth.unauthorized", {
        reason: "missing_token",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
      return;
    }

    // Try standard access token first (re-enrollment by an already-enrolled user).
    try {
      req.user = authService.authenticateAccessToken(token);
      next();
      return;
    } catch {
      // Not a valid access token — fall through to enrollment token check.
    }

    // Try MFA enrollment token (privileged user completing first enrollment).
    try {
      req.user = authService.verifyMfaEnrollmentToken(token);
      next();
    } catch {
      audit.logAuthEvent("auth.unauthorized", {
        reason: "invalid_token",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      next(new AppError(401, "UNAUTHORIZED", "Invalid or expired token"));
    }
  };
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError(403, "FORBIDDEN", "Insufficient permissions"));
      return;
    }

    next();
  };
}

/**
 * Guards a route using the request-time authoritative permission set.
 *
 * JWT permissions are only a UI/backward-compatibility hint. Authentication
 * reloads the current user identity and home-clinic grants, and clinic scope
 * middleware replaces them with grants for the actual target clinic.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
      return;
    }

    if (!req.user.permissions.includes(permission)) {
      next(
        new AppError(
          403,
          "FORBIDDEN",
          `Permission "${permission}" is required for this action`,
        ),
      );
      return;
    }

    next();
  };
}

export function enforceTenantParam(paramName = "clinicId") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
      return;
    }

    const clinicId = req.params[paramName];

    if (!clinicId) {
      next(new AppError(400, "VALIDATION_ERROR", `Missing route parameter: ${paramName}`));
      return;
    }

    if (req.user.role === "owner_admin" || req.authorizedClinicId === clinicId) {
      next();
      return;
    }

    if (req.user.homeClinicId !== clinicId) {
      next(
        new AppError(
          403,
          "TENANT_ACCESS_DENIED",
          "You do not have access to this clinic's data",
        ),
      );
      return;
    }

    next();
  };
}
