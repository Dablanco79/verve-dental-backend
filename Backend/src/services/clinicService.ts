import type { AuthenticatedUser } from "../types/auth.js";
import type { Clinic, CreateClinicInput, UpdateClinicInput } from "../types/clinic.js";
import { AppError } from "../types/errors.js";
import type { ClinicRepository } from "../repositories/clinicRepository.js";
import type { CreateAuditEventInput } from "../types/analytics.js";

type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

export type ClinicService = ReturnType<typeof createClinicService>;

export function createClinicService(
  clinicRepository: ClinicRepository,
  auditWriter?: AuditWriter,
) {
  /**
   * Asserts the caller is entitled to read the given clinic.
   *
   * Access rules:
   *   • owner_admin  — unrestricted; may read any clinic.
   *   • all others   — restricted to their own home clinic only.
   *
   * This check is defence-in-depth; `enforceTenantParam` middleware enforces
   * the same boundary at the HTTP layer before the service is reached.
   */
  function assertReadAccess(
    caller: AuthenticatedUser,
    clinicId: string,
  ): void {
    if (caller.role === "owner_admin") return;
    if (caller.homeClinicId === clinicId) return;
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to view this clinic",
    );
  }

  return {
    /**
     * Returns the full clinic record for `clinicId`.
     * Throws 403 when a non-admin caller requests a clinic other than their own.
     * Throws 404 when the clinic does not exist.
     */
    async getClinic(
      caller: AuthenticatedUser,
      clinicId: string,
    ): Promise<Clinic> {
      assertReadAccess(caller, clinicId);

      const clinic = await clinicRepository.findById(clinicId);
      if (!clinic) {
        throw new AppError(404, "CLINIC_NOT_FOUND", "Clinic not found");
      }
      return clinic;
    },

    /**
     * Lists clinics visible to the caller.
     *
     *   • owner_admin  — all active clinics, ordered by name.
     *   • all others   — only their own home clinic (single-element array,
     *                     or empty when the clinic record is missing).
     */
    async listClinics(caller: AuthenticatedUser): Promise<Clinic[]> {
      if (caller.role === "owner_admin") {
        return clinicRepository.findAll();
      }

      const clinic = await clinicRepository.findById(caller.homeClinicId);
      return clinic ? [clinic] : [];
    },

    /**
     * Creates a new clinic.
     * Restricted to `owner_admin` — no other role may provision a new clinic.
     * Throws 403 for any non-admin caller.
     */
    async createClinic(
      caller: AuthenticatedUser,
      input: CreateClinicInput,
    ): Promise<Clinic> {
      if (caller.role !== "owner_admin") {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Only owner_admin may create clinics",
        );
      }

      const clinic = await clinicRepository.create(input);

      auditWriter?.recordEvent({
        clinicId: clinic.id,
        entityType: "clinic",
        entityId: clinic.id,
        action: "created",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: { name: clinic.name, timezone: clinic.timezone },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return clinic;
    },

    /**
     * Applies a partial update to an existing clinic.
     * Restricted to `owner_admin` — no other role may mutate clinic metadata.
     * Throws 403 for any non-admin caller.
     * Throws 404 when the clinic does not exist.
     */
    async updateClinic(
      caller: AuthenticatedUser,
      clinicId: string,
      input: UpdateClinicInput,
    ): Promise<Clinic> {
      if (caller.role !== "owner_admin") {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Only owner_admin may update clinic details",
        );
      }

      const existing = await clinicRepository.findById(clinicId);
      if (!existing) {
        throw new AppError(404, "CLINIC_NOT_FOUND", "Clinic not found");
      }

      const updated = await clinicRepository.update(clinicId, input);

      // update() returns null only when the ID doesn't exist — we already
      // confirmed existence above, so this is a programming error guard.
      if (!updated) {
        throw new AppError(
          500,
          "UPDATE_FAILED",
          "Clinic update failed unexpectedly",
        );
      }

      auditWriter?.recordEvent({
        clinicId,
        entityType: "clinic",
        entityId: clinicId,
        action: "updated",
        actorId: caller.id,
        actorEmail: caller.email,
        metadata: { changedFields: Object.keys(input) },
      }).catch((err: unknown) => {
        console.error("[Audit Failure Guard]:", err);
      });

      return updated;
    },
  };
}
