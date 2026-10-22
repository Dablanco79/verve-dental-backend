import { randomUUID } from "node:crypto";

import type {
  CoverageGroup,
  LeaveCoverageSettings,
  LeaveCoverageWarning,
} from "../types/leaveCoverage.js";
import { AppError } from "../types/errors.js";
import type { LeaveRepository } from "./leaveRepository.js";
import type { UserClinicAssignmentsRepository } from "./userClinicAssignmentsRepository.js";

export interface LeaveCoverageRepository {
  getSettings(clinicId: string): Promise<LeaveCoverageSettings>;
  updateSettings(clinicId: string, enabled: boolean): Promise<LeaveCoverageSettings>;
  listGroups(clinicId: string): Promise<CoverageGroup[]>;
  createGroup(clinicId: string, name: string): Promise<CoverageGroup>;
  updateGroup(clinicId: string, groupId: string, name: string): Promise<CoverageGroup>;
  replaceMembers(
    clinicId: string,
    groupId: string,
    memberUserIds: string[],
  ): Promise<CoverageGroup>;
  getWarning(
    clinicId: string,
    subjectUserId: string,
    startDate: string,
    endDate: string,
  ): Promise<LeaveCoverageWarning>;
}

export function createInMemoryLeaveCoverageRepository(
  assignments: UserClinicAssignmentsRepository,
  leave: LeaveRepository,
): LeaveCoverageRepository {
  const settings = new Map<string, boolean>();
  const groups: CoverageGroup[] = [];

  const clone = (group: CoverageGroup): CoverageGroup => ({
    ...group,
    memberUserIds: [...group.memberUserIds],
  });

  const requireGroup = (clinicId: string, groupId: string): CoverageGroup => {
    const group = groups.find((item) => item.id === groupId && item.clinicId === clinicId);
    if (!group) throw new AppError(404, "NOT_FOUND", "Coverage group not found");
    return group;
  };

  return {
    getSettings(clinicId) {
      return Promise.resolve({ clinicId, enabled: settings.get(clinicId) ?? false });
    },

    updateSettings(clinicId, enabled) {
      settings.set(clinicId, enabled);
      return Promise.resolve({ clinicId, enabled });
    },

    listGroups(clinicId) {
      return Promise.resolve(
        groups
          .filter((group) => group.clinicId === clinicId)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(clone),
      );
    },

    createGroup(clinicId, name) {
      if (groups.some((group) => group.clinicId === clinicId && group.name === name)) {
        return Promise.reject(new AppError(409, "COVERAGE_GROUP_NAME_EXISTS", "Coverage group name already exists"));
      }
      const now = new Date();
      const group: CoverageGroup = {
        id: randomUUID(),
        clinicId,
        name,
        memberUserIds: [],
        createdAt: now,
        updatedAt: now,
      };
      groups.push(group);
      return Promise.resolve(clone(group));
    },

    updateGroup(clinicId, groupId, name) {
      const group = requireGroup(clinicId, groupId);
      if (groups.some((item) => item.id !== groupId && item.clinicId === clinicId && item.name === name)) {
        return Promise.reject(new AppError(409, "COVERAGE_GROUP_NAME_EXISTS", "Coverage group name already exists"));
      }
      group.name = name;
      group.updatedAt = new Date();
      return Promise.resolve(clone(group));
    },

    async replaceMembers(clinicId, groupId, memberUserIds) {
      const group = requireGroup(clinicId, groupId);
      const uniqueIds = [...new Set(memberUserIds)];
      const eligibility = await Promise.all(
        uniqueIds.map(async (userId) => ({
          userId,
          eligible: await assignments.hasRosterEligibility(userId, clinicId),
        })),
      );
      const invalid = eligibility.filter((item) => !item.eligible).map((item) => item.userId);
      if (invalid.length > 0) {
        throw new AppError(
          400,
          "INVALID_COVERAGE_MEMBERS",
          "All members must be roster-eligible at this clinic",
          invalid.map((userId) => ({
            field: "memberUserIds",
            message: `${userId} is not roster-eligible at this clinic`,
          })),
        );
      }
      group.memberUserIds = uniqueIds;
      group.updatedAt = new Date();
      return clone(group);
    },

    async getWarning(clinicId, subjectUserId, startDate, endDate) {
      const enabled = settings.get(clinicId) ?? false;
      const empty = (status: LeaveCoverageWarning["status"]): LeaveCoverageWarning => ({
        enabled,
        status,
        overlappingColleagueCount: 0,
        affectedGroups: [],
      });
      if (!enabled) return empty("disabled");
      const clinicGroups = groups.filter((group) => group.clinicId === clinicId);
      if (clinicGroups.length === 0) return empty("unconfigured");
      const subjectGroups = clinicGroups.filter((group) => group.memberUserIds.includes(subjectUserId));
      if (subjectGroups.length === 0) return empty("staff_unassigned");

      const peerIds = [...new Set(
        subjectGroups.flatMap((group) => group.memberUserIds).filter((id) => id !== subjectUserId),
      )];
      const overlaps = await leave.listApprovedForStaff(peerIds, startDate, endDate);
      const overlappingPeerIds = new Set(overlaps.map((item) => item.staffUserId));
      return {
        enabled: true,
        status: "ready",
        overlappingColleagueCount: overlappingPeerIds.size,
        affectedGroups: subjectGroups
          .filter((group) => group.memberUserIds.some((id) => overlappingPeerIds.has(id)))
          .map((group) => ({
            clinicId: group.clinicId,
            groupId: group.id,
            groupName: group.name,
          })),
      };
    },
  };
}
