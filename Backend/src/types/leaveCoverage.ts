export type LeaveCoverageStatus =
  | "disabled"
  | "unconfigured"
  | "staff_unassigned"
  | "ready";

export type LeaveCoverageAffectedGroup = {
  clinicId: string;
  groupId: string;
  groupName: string;
};

/**
 * Deliberately privacy-minimal. No peer identity or leave details may be added
 * to this response without a separate privacy review.
 */
export type LeaveCoverageWarning = {
  enabled: boolean;
  status: LeaveCoverageStatus;
  overlappingColleagueCount: number;
  affectedGroups: LeaveCoverageAffectedGroup[];
};

export type LeaveCoverageSettings = {
  clinicId: string;
  enabled: boolean;
};

export type CoverageGroup = {
  id: string;
  clinicId: string;
  name: string;
  memberUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
};
