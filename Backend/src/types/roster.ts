export const SHIFT_TYPES = [
  "standard",
  "overtime",
  "on_call",
  "training",
] as const;

export type ShiftType = (typeof SHIFT_TYPES)[number];

export const ROSTER_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
] as const;

export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export const ROSTER_AUDIT_ACTIONS = [
  "created",
  "updated",
  "cancelled",
] as const;

export type RosterAuditAction = (typeof ROSTER_AUDIT_ACTIONS)[number];

export type RosterEntry = {
  id: string;
  staffUserId: string;
  staffEmail: string;
  rosteredClinicId: string;
  rosteredClinicName: string;
  /** UTC timestamp — shift start time. */
  shiftStartAt: Date;
  /** UTC timestamp — shift end time. May be after midnight (overnight shifts). */
  shiftEndAt: Date;
  shiftType: ShiftType;
  /** Lifecycle: scheduled → confirmed → completed | cancelled */
  status: RosterStatus;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RosterEntryAudit = {
  id: string;
  rosterEntryId: string;
  changedByUserId: string;
  changedByEmail: string;
  action: RosterAuditAction;
  /** Full entry snapshot at the time of the change. */
  snapshot: RosterEntry;
  createdAt: Date;
};

export type CreateRosterEntryInput = {
  staffUserId: string;
  staffEmail: string;
  rosteredClinicId: string;
  rosteredClinicName: string;
  shiftStartAt: Date;
  shiftEndAt: Date;
  shiftType: ShiftType;
  notes: string | null;
  createdByUserId: string;
  /** Email of the user who created this entry (the caller), NOT the staff member. */
  createdByEmail: string;
};

export type UpdateRosterEntryInput = {
  shiftStartAt?: Date;
  shiftEndAt?: Date;
  shiftType?: ShiftType;
  status?: RosterStatus;
  notes?: string | null;
};

export type ListRosterOptions = {
  from?: Date;
  to?: Date;
  status?: RosterStatus;
};
