import { randomUUID } from "node:crypto";

import {
  SEED_CLINIC_A_ID,
  SEED_CLINIC_B_ID,
  SEED_USER_IDS,
} from "./userRepository.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClinicAssignment = {
  id: string;
  userId: string;
  clinicId: string;
  canRoster: boolean;
  canOperate: boolean;
  assignedByUserId: string | null;
  assignedAt: Date;
  updatedAt: Date;
};

export type UpsertAssignmentInput = {
  userId: string;
  clinicId: string;
  canRoster: boolean;
  canOperate: boolean;
  assignedByUserId?: string | null;
};

// ─── Interface ────────────────────────────────────────────────────────────────

export interface UserClinicAssignmentsRepository {
  /**
   * Returns all clinic assignments for a given user.
   * Used by the Owner/Admin assignment UI and by JWT enrichment.
   */
  listByUser(userId: string): Promise<ClinicAssignment[]>;

  /**
   * Returns all assignments for a given clinic.
   * Used by the Owner/Admin clinic member view.
   */
  listByClinic(clinicId: string): Promise<ClinicAssignment[]>;

  /**
   * Returns active users who are roster-eligible (can_roster=true) at the
   * given clinic. Used by the Add Shift staff selector.
   *
   * activeOnly: when true (default), only returns assignments for users
   * with is_active=true (joined against the users table).
   */
  listRosterEligible(clinicId: string, activeOnly?: boolean): Promise<ClinicAssignment[]>;

  /**
   * Returns clinic IDs where the user has can_operate=true.
   * Used by GPM multi-clinic access control.
   */
  listOperationalClinicIds(userId: string): Promise<string[]>;

  /**
   * Returns true when the user has can_operate=true for the specified clinic.
   * Used by rlsTenantContextMiddleware to validate GPM clinic switches.
   */
  hasOperationalAccess(userId: string, clinicId: string): Promise<boolean>;

  /**
   * Returns true when the user has can_roster=true for the specified clinic.
   * Used by rosterService to enforce eligibility on shift creation.
   */
  hasRosterEligibility(userId: string, clinicId: string): Promise<boolean>;

  /**
   * Creates or updates the assignment row for (userId, clinicId).
   * Uses UPSERT semantics — safe to call on first assignment or re-assignment.
   */
  upsert(input: UpsertAssignmentInput): Promise<ClinicAssignment>;

  /**
   * Replaces ALL clinic assignments for a user in one operation.
   * Used by the Owner/Admin assignment UI "Save" action.
   * Any clinics not in the new list are deleted; upsert handles the rest.
   */
  replaceForUser(
    userId: string,
    assignments: UpsertAssignmentInput[],
    grantedByUserId: string,
  ): Promise<ClinicAssignment[]>;

  /**
   * Removes the assignment row for (userId, clinicId).
   * Returns true when a row was deleted, false when it did not exist.
   */
  remove(userId: string, clinicId: string): Promise<boolean>;
}

// ─── In-Memory Implementation (tests + DATABASE_URL-less dev) ────────────────

/**
 * Pre-seeded with home-clinic assignments for all seed users so tests that
 * rely on roster-eligibility work without a database.
 */
export function createInMemoryUserClinicAssignmentsRepository(): UserClinicAssignmentsRepository {
  const SEED_CREATED_AT = new Date("2024-01-01T00:00:00.000Z");

  const assignments: ClinicAssignment[] = [
    // Clinic A seed users
    {
      id: "aaaa0001-0000-4000-8000-000000000001",
      userId: SEED_USER_IDS.clinicAAdmin,
      clinicId: SEED_CLINIC_A_ID,
      canRoster: true,
      canOperate: true,
      assignedByUserId: null,
      assignedAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
    {
      id: "aaaa0002-0000-4000-8000-000000000002",
      userId: SEED_USER_IDS.clinicAStaff,
      clinicId: SEED_CLINIC_A_ID,
      canRoster: true,
      canOperate: true,
      assignedByUserId: null,
      assignedAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
    {
      id: "aaaa0003-0000-4000-8000-000000000003",
      userId: SEED_USER_IDS.clinicAManager,
      clinicId: SEED_CLINIC_A_ID,
      canRoster: true,
      canOperate: true,
      assignedByUserId: null,
      assignedAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
    // Clinic B seed users
    {
      id: "bbbb0001-0000-4000-8000-000000000001",
      userId: SEED_USER_IDS.clinicBAdmin,
      clinicId: SEED_CLINIC_B_ID,
      canRoster: true,
      canOperate: true,
      assignedByUserId: null,
      assignedAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
  ];

  return {
    listByUser(userId: string): Promise<ClinicAssignment[]> {
      return Promise.resolve(
        assignments.filter((a) => a.userId === userId).map((a) => ({ ...a })),
      );
    },

    listByClinic(clinicId: string): Promise<ClinicAssignment[]> {
      return Promise.resolve(
        assignments.filter((a) => a.clinicId === clinicId).map((a) => ({ ...a })),
      );
    },

    listRosterEligible(clinicId: string): Promise<ClinicAssignment[]> {
      // In-memory: return assignments with can_roster=true at this clinic.
      // (active-only filtering is applied at the service layer via user lookup)
      return Promise.resolve(
        assignments
          .filter((a) => a.clinicId === clinicId && a.canRoster)
          .map((a) => ({ ...a })),
      );
    },

    listOperationalClinicIds(userId: string): Promise<string[]> {
      return Promise.resolve(
        assignments
          .filter((a) => a.userId === userId && a.canOperate)
          .map((a) => a.clinicId),
      );
    },

    hasOperationalAccess(userId: string, clinicId: string): Promise<boolean> {
      return Promise.resolve(
        assignments.some((a) => a.userId === userId && a.clinicId === clinicId && a.canOperate),
      );
    },

    hasRosterEligibility(userId: string, clinicId: string): Promise<boolean> {
      return Promise.resolve(
        assignments.some((a) => a.userId === userId && a.clinicId === clinicId && a.canRoster),
      );
    },

    upsert(input: UpsertAssignmentInput): Promise<ClinicAssignment> {
      const now = new Date();
      const existing = assignments.find(
        (a) => a.userId === input.userId && a.clinicId === input.clinicId,
      );
      if (existing) {
        existing.canRoster = input.canRoster;
        existing.canOperate = input.canOperate;
        existing.assignedByUserId = input.assignedByUserId ?? existing.assignedByUserId;
        existing.updatedAt = now;
        return Promise.resolve({ ...existing });
      }
      const created: ClinicAssignment = {
        id: randomUUID(),
        userId: input.userId,
        clinicId: input.clinicId,
        canRoster: input.canRoster,
        canOperate: input.canOperate,
        assignedByUserId: input.assignedByUserId ?? null,
        assignedAt: now,
        updatedAt: now,
      };
      assignments.push(created);
      return Promise.resolve({ ...created });
    },

    async replaceForUser(
      userId: string,
      newAssignments: UpsertAssignmentInput[],
      grantedByUserId: string,
    ): Promise<ClinicAssignment[]> {
      // Remove all rows for this user that are NOT in the new list.
      const newClinicIds = new Set(newAssignments.map((a) => a.clinicId));
      const toRemove = assignments.filter(
        (a) => a.userId === userId && !newClinicIds.has(a.clinicId),
      );
      for (const row of toRemove) {
        const idx = assignments.indexOf(row);
        if (idx !== -1) assignments.splice(idx, 1);
      }
      // Upsert all new/updated rows.
      const results: ClinicAssignment[] = [];
      for (const a of newAssignments) {
        results.push(
          await this.upsert({ ...a, assignedByUserId: grantedByUserId }),
        );
      }
      return results;
    },

    remove(userId: string, clinicId: string): Promise<boolean> {
      const idx = assignments.findIndex(
        (a) => a.userId === userId && a.clinicId === clinicId,
      );
      if (idx === -1) return Promise.resolve(false);
      assignments.splice(idx, 1);
      return Promise.resolve(true);
    },
  };
}
