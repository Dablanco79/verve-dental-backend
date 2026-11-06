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

/** Privacy-minimal warning. It intentionally contains no colleague or leave details. */
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
  createdAt: string;
  updatedAt: string;
};
