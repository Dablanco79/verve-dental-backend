import type { Request, Response } from "express";
import { z } from "zod";

import { USER_ROLES } from "../types/auth.js";
import type { UserService } from "../services/userService.js";
import { parseBody } from "../utils/validation.js";
import { AppError } from "../types/errors.js";

function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return "";
}

const createUserSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  role: z.enum(USER_ROLES),
  clinicName: z.string().min(1, "Clinic name is required").max(120),
});

const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export function createUserHandlers(userService: UserService) {
  return {
    async listUsers(req: Request, res: Response): Promise<void> {
      const caller = req.user;

      if (!caller) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = routeParam(req.params.clinicId);
      const users = await userService.listUsers(caller, clinicId);
      res.status(200).json({ data: users });
    },

    async createUser(req: Request, res: Response): Promise<void> {
      const caller = req.user;

      if (!caller) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = routeParam(req.params.clinicId);
      const body = parseBody(createUserSchema, req.body);

      const user = await userService.createUser(caller, {
        email: body.email,
        password: body.password,
        role: body.role,
        homeClinicId: clinicId,
        homeClinicName: body.clinicName,
      });

      res.status(201).json({ data: user });
    },

    async resetPassword(req: Request, res: Response): Promise<void> {
      const caller = req.user;

      if (!caller) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const targetUserId = routeParam(req.params.userId);
      const body = parseBody(resetPasswordSchema, req.body);

      await userService.resetPassword(caller, targetUserId, body.newPassword);

      res.status(200).json({ data: { message: "Password reset successfully." } });
    },
  };
}

export type UserHandlers = ReturnType<typeof createUserHandlers>;
