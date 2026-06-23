import type { NextFunction, Request, Response } from "express";

import type { AuthService } from "../services/authService.js";
import type { AuditService } from "../services/auditService.js";
import type { UserRole } from "../types/auth.js";
import type { Permission } from "../types/permissions.js";
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

    try {
      req.user = authService.authenticateAccessToken(token);
      next();
    } catch {
      audit.logAuthEvent("auth.unauthorized", {
        reason: "invalid_token",
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      next(new AppError(401, "UNAUTHORIZED", "Invalid or expired access token"));
    }
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
 * Guards a route by checking that the authenticated user's token contains
 * the specified permission string.
 *
 * Effective permissions are baked into the JWT at issuance time as the union
 * of DEFAULT_PERMISSIONS[role] and any active user_permission_grants rows.
 * This middleware does NOT make a DB round-trip on each request.
 *
 * This is additive infrastructure — existing requireRoles guards are not
 * replaced until RBAC v2 is fully rolled out.
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

    if (req.user.role === "owner_admin") {
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
