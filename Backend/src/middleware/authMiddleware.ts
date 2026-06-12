import type { NextFunction, Request, Response } from "express";

import type { AuthService } from "../services/authService.js";
import type { AuditService } from "../services/auditService.js";
import type { UserRole } from "../types/auth.js";
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

    if (req.user.clinicId !== clinicId) {
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
