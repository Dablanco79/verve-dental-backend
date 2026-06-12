export type ShiftType = "standard" | "overtime" | "on_call" | "training";
export type RosterStatus = "scheduled" | "confirmed" | "completed" | "cancelled";

export type RosterEntry = {
  id: string;
  staffUserId: string;
  staffEmail: string;
  rosteredClinicId: string;
  rosteredClinicName: string;
  /** UTC ISO-8601 timestamp */
  shiftStartAt: string;
  /** UTC ISO-8601 timestamp */
  shiftEndAt: string;
  shiftType: ShiftType;
  /** Lifecycle: scheduled → confirmed → completed | cancelled */
  status: RosterStatus;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateShiftRequest = {
  staffUserId: string;
  rosteredClinicName: string;
  shiftStartAt: string;
  shiftEndAt: string;
  shiftType: ShiftType;
  notes?: string | null;
};

export type UpdateShiftRequest = {
  shiftStartAt?: string;
  shiftEndAt?: string;
  shiftType?: ShiftType;
  status?: RosterStatus;
  notes?: string | null;
};

export const SHIFT_TYPE_LABELS: Record<ShiftType, string> = {
  standard: "Standard",
  overtime: "Overtime",
  on_call: "On Call",
  training: "Training",
};

export const ROSTER_STATUS_LABELS: Record<RosterStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ALL_SHIFT_TYPES: ShiftType[] = [
  "standard",
  "overtime",
  "on_call",
  "training",
];
