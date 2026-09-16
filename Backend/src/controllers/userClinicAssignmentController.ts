import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { parseBody } from "../utils/validation.js";
import type { UserClinicAssignmentsRepository } from "../repositories/userClinicAssignmentsRepository.js";
import type { ClinicRepository } from "../repositories/clinicRepository.js";
import type { UserRepository } from "../repositories/userRepository.js";

function routeParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return "";
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(req: Request, paramName: string): string {
  const value = routeParam((req.params as Record<string, string | undefined>)[paramName]);
  if (!UUID_REGEX.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
      { field: paramName, message: `${paramName} must be a valid UUID` },
    ]);
  }
  return value;
}

const replaceAssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      clinicId: z.string().uuid("clinicId must be a valid UUID"),
      canRoster: z.boolean(),
      canOperate: z.boolean(),
    }),
  ),
});

export function createClinicAssignmentHandlers(
  assignmentsRepository: UserClinicAssignmentsRepository,
  clinicRepository: ClinicRepository,
  userRepository: UserRepository,
) {
  return {
    /**
     * GET /clinics/:clinicId/users/:userId/clinic-access
     * Returns all clinic assignments for a user.
     * Only owner_admin may call this.
     */
    async getForUser(req: Request, res: Response): Promise<void> {
      const caller = req.user;
      if (!caller) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      if (caller.role !== "owner_admin") {
        throw new AppError(403, "FORBIDDEN", "Only owner_admin may view clinic access");
      }

      const userId = requireUuidParam(req, "userId");

      const user = await userRepository.findById(userId);
      if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

      const [assignments, allClinics] = await Promise.all([
        assignmentsRepository.listByUser(userId),
        clinicRepository.findAll(),
      ]);

      res.status(200).json({
        data: {
          userId,
          assignments,
          availableClinics: allClinics.map((c) => ({ id: c.id, name: c.name })),
        },
      });
    },

    /**
     * PUT /clinics/:clinicId/users/:userId/clinic-access
     * Replaces all clinic assignments for a user.
     * Only owner_admin may call this.
     */
    async replaceForUser(req: Request, res: Response): Promise<void> {
      const caller = req.user;
      if (!caller) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      if (caller.role !== "owner_admin") {
        throw new AppError(403, "FORBIDDEN", "Only owner_admin may manage clinic access");
      }

      const userId = requireUuidParam(req, "userId");

      const user = await userRepository.findById(userId);
      if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

      const body = parseBody(replaceAssignmentsSchema, req.body);

      // Validate that all clinicIds in the payload actually exist.
      const clinicChecks = await Promise.all(
        body.assignments.map((a) => clinicRepository.findById(a.clinicId)),
      );
      for (let i = 0; i < clinicChecks.length; i++) {
        if (!clinicChecks[i]) {
          throw new AppError(
            404,
            "CLINIC_NOT_FOUND",
            `Clinic ${body.assignments[i]?.clinicId ?? "unknown"} not found`,
          );
        }
      }

      const updated = await assignmentsRepository.replaceForUser(
        userId,
        body.assignments.map((a) => ({
          userId,
          clinicId: a.clinicId,
          canRoster: a.canRoster,
          canOperate: a.canOperate,
          assignedByUserId: caller.id,
        })),
        caller.id,
      );

      res.status(200).json({ data: updated });
    },

    /**
     * GET /users/me/operational-clinics
     * Returns the list of clinics where the authenticated GPM has can_operate=true.
     * Used by the frontend clinic selector for GPM multi-clinic switching.
     */
    async getOperationalClinics(req: Request, res: Response): Promise<void> {
      const caller = req.user;
      if (!caller) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

      if (caller.role === "owner_admin") {
        // owner_admin: all active clinics.
        const clinics = await clinicRepository.findAll();
        res.status(200).json({ data: clinics.map((c) => ({ id: c.id, name: c.name })) });
        return;
      }

      if (caller.role === "group_practice_manager") {
        const clinicIds = await assignmentsRepository.listOperationalClinicIds(caller.id);
        const clinics = await Promise.all(
          clinicIds.map((id) => clinicRepository.findById(id)),
        );
        res.status(200).json({
          data: clinics
            .filter((c): c is NonNullable<typeof c> => c !== null && c.isActive)
            .map((c) => ({ id: c.id, name: c.name })),
        });
        return;
      }

      // clinical_staff: only their home clinic.
      res.status(200).json({
        data: [{ id: caller.homeClinicId, name: caller.homeClinicName }],
      });
    },
  };
}

export type ClinicAssignmentHandlers = ReturnType<typeof createClinicAssignmentHandlers>;
