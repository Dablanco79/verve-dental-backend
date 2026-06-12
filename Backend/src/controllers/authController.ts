import type { Request, Response } from "express";
import { z } from "zod";

import type { AuthService } from "../services/authService.js";
import { parseBody } from "../utils/validation.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().length(6),
});

function auditContext(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  };
}

export function createAuthHandlers(authService: AuthService) {
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

      res.status(200).json({
        data: {
          requiresMfa: false,
          ...result.tokens,
          user: result.user,
        },
      });
    },

    async verifyMfa(req: Request, res: Response): Promise<void> {
      const body = parseBody(mfaVerifySchema, req.body);
      const result = await authService.verifyMfa(body.mfaToken, body.code, auditContext(req));

      res.status(200).json({
        data: {
          ...result.tokens,
          user: result.user,
        },
      });
    },

    async refresh(req: Request, res: Response): Promise<void> {
      const body = parseBody(refreshSchema, req.body);
      const result = await authService.refresh(body.refreshToken, auditContext(req));

      res.status(200).json({
        data: {
          ...result.tokens,
          user: result.user,
        },
      });
    },

    logout(req: Request, res: Response): void {
      const body = parseBody(logoutSchema, req.body ?? {});
      authService.logout(body.refreshToken, {
        userId: req.user?.id,
        ...auditContext(req),
      });

      res.status(204).send();
    },

    me(req: Request, res: Response): void {
      res.status(200).json({ data: req.user });
    },

    getClinicSummary(req: Request, res: Response): void {
      res.status(200).json({
        data: {
          clinicId: req.params.clinicId,
          clinicName: req.user?.clinicName ?? "Unknown clinic",
          accessedBy: req.user?.email,
          message: "Tenant-scoped resource access verified",
        },
      });
    },
  };
}

export type AuthHandlers = ReturnType<typeof createAuthHandlers>;
