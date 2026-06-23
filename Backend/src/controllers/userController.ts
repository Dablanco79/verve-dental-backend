import type { Request, Response } from "express";
import { z } from "zod";

import { USER_ROLES } from "../types/auth.js";
import { STAFF_PAYROLL_TRACKS } from "../types/payroll.js";
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
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  displayName: z.string().min(1).max(200).optional().nullable(),
});

const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

const updateUserSchema = z
  .object({
    firstName: z.string().min(1, "First name cannot be empty").max(100).optional(),
    lastName: z.string().min(1, "Last name cannot be empty").max(100).optional(),
    displayName: z.string().min(1).max(200).nullable().optional(),
    payrollTrack: z.enum(STAFF_PAYROLL_TRACKS).optional(),
    role: z.enum(USER_ROLES).optional(),
    homeClinicId: z.string().uuid("homeClinicId must be a valid UUID").optional(),
    homeClinicName: z.string().min(1).max(120).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  })
  .refine(
    (data) => {
      const hasId = data.homeClinicId !== undefined;
      const hasName = data.homeClinicName !== undefined;
      return hasId === hasName;
    },
    { message: "homeClinicId and homeClinicName must be provided together" },
  );

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
        firstName: body.firstName,
        lastName: body.lastName,
        displayName: body.displayName,
      });

      res.status(201).json({ data: user });
    },

    async updateUser(req: Request, res: Response): Promise<void> {
      const caller = req.user;

      if (!caller) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const clinicId = routeParam(req.params.clinicId);
      const targetUserId = routeParam(req.params.userId);
      const body = parseBody(updateUserSchema, req.body);

      const updated = await userService.updateUser(caller, clinicId, targetUserId, body);

      res.status(200).json({ data: updated });
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
