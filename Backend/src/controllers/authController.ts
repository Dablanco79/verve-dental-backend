import type { Request, Response } from "express";
import { z } from "zod";

import type { EnvConfig } from "../config/index.js";
import type { AuthService } from "../services/authService.js";
import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().length(6),
});

const mfaConfirmSchema = z.object({
  code: z.string().length(6),
});

const REFRESH_COOKIE_NAME = "refreshToken";

/** Parse a JWT expiry string like "7d", "15m", "3600s" into milliseconds. */
function parseTtlMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "d";
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

function auditContext(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  };
}

export function createAuthHandlers(authService: AuthService, config: EnvConfig) {
  const cookieMaxAge = parseTtlMs(config.JWT_REFRESH_EXPIRES_IN);

  function setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      // Scoped to auth endpoints — covers /auth/refresh and /auth/logout.
      path: "/api/v1/auth",
      maxAge: cookieMaxAge,
    });
  }

  function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
    });
  }

  return {
    async login(req: Request, res: Response): Promise<void> {
      const body = parseBody(loginSchema, req.body);
      const result = await authService.login(body.email, body.password, auditContext(req));

      if (result.kind === "mfa_required") {
        res.status(200).json({
          data: {
            requiresMfa: true,
            mfaToken: result.mfaToken,
            user: result.user,
          },
        });
        return;
      }

      setRefreshCookie(res, result.tokens.refreshToken);
      const { accessToken, expiresIn } = result.tokens;
      res.status(200).json({
        data: {
          requiresMfa: false,
          accessToken,
          expiresIn,
          user: result.user,
        },
      });
    },

    async verifyMfa(req: Request, res: Response): Promise<void> {
      const body = parseBody(mfaVerifySchema, req.body);
      const result = await authService.verifyMfa(body.mfaToken, body.code, auditContext(req));

      setRefreshCookie(res, result.tokens.refreshToken);
      const { accessToken: mfaAccessToken, expiresIn: mfaExpiresIn } = result.tokens;
      res.status(200).json({
        data: {
          accessToken: mfaAccessToken,
          expiresIn: mfaExpiresIn,
          user: result.user,
        },
      });
    },

    async refresh(req: Request, res: Response): Promise<void> {
      const refreshToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        throw new AppError(400, "MISSING_REFRESH_TOKEN", "Refresh token required");
      }

      const result = await authService.refresh(refreshToken, auditContext(req));

      setRefreshCookie(res, result.tokens.refreshToken);
      const { accessToken, expiresIn } = result.tokens;
      res.status(200).json({
        data: {
          accessToken,
          expiresIn,
          user: result.user,
        },
      });
    },

    async logout(req: Request, res: Response): Promise<void> {
      const tokenToRevoke = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];

      await authService.logout(tokenToRevoke, {
        userId: req.user?.id,
        ...auditContext(req),
      });

      clearRefreshCookie(res);
      res.status(204).send();
    },

    me(req: Request, res: Response): void {
      res.status(200).json({ data: req.user });
    },

    async changePassword(req: Request, res: Response): Promise<void> {
      const body = parseBody(changePasswordSchema, req.body);

      if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      const userId = req.user.id;

      await authService.changePassword(
        userId,
        body.currentPassword,
        body.newPassword,
        auditContext(req),
      );

      res.status(200).json({ data: { message: "Password changed successfully. Please log in again." } });
    },

    async setupMfa(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");

      const result = await authService.setupMfa(req.user.id, auditContext(req));

      res.status(200).json({ data: result });
    },

    async confirmMfa(req: Request, res: Response): Promise<void> {
      if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication required");

      const body = parseBody(mfaConfirmSchema, req.body);

      await authService.confirmMfa(req.user.id, body.code, auditContext(req));

      res.status(200).json({ data: { message: "MFA enrollment complete" } });
    },

    getClinicSummary(req: Request, res: Response): void {
      res.status(200).json({
        data: {
          clinicId: req.params.clinicId,
          homeClinicName: req.user?.homeClinicName ?? "Unknown clinic",
          accessedBy: req.user?.email,
          message: "Tenant-scoped resource access verified",
        },
      });
    },
  };
}

export type AuthHandlers = ReturnType<typeof createAuthHandlers>;
