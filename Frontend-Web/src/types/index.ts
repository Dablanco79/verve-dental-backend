export type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

export type UserRole =
  | "owner_admin"
  | "group_practice_manager"
  | "clinical_staff";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  /** Payroll / contract location — not the clinic currently being accessed via URL. */
  homeClinicId: string;
  homeClinicName: string;
  /** Nullable for users created before Sprint 1. */
  firstName: string | null;
  /** Nullable for users created before Sprint 1. */
  lastName: string | null;
  /**
   * Preferred display name, e.g. "Jane Smith".
   * Defaults to "firstName lastName" on creation.
   * Nullable for users created before Sprint 1.
   */
  displayName: string | null;
};

export type AuthSession = {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
};

export type LoginResponse =
  | {
      requiresMfa: false;
      accessToken: string;
      expiresIn: number;
      user: AuthUser;
    }
  | {
      requiresMfa: true;
      mfaToken: string;
      user: AuthUser;
    }
  | {
      requiresMfaEnrollment: true;
      enrollmentToken: string;
      user: AuthUser;
    };

/** Response shape for POST /auth/mfa/setup */
export type MfaSetupData = {
  secret: string;
  uri: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export const STAFF_PAYROLL_TRACKS = ["hourly", "commission"] as const;
export type StaffPayrollTrack = (typeof STAFF_PAYROLL_TRACKS)[number];

export const PAYROLL_TRACK_LABELS: Record<StaffPayrollTrack, string> = {
  hourly: "Hourly",
  commission: "Commission",
};

export type StaffUser = {
  id: string;
  email: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  payrollTrack: StaffPayrollTrack;
};

export type CreateUserRequest = {
  email: string;
  password: string;
  role: UserRole;
  clinicName: string;
  firstName: string;
  lastName: string;
  displayName?: string | null;
};

export type UpdateUserRequest = {
  firstName?: string;
  lastName?: string;
  displayName?: string | null;
  payrollTrack?: StaffPayrollTrack;
  role?: UserRole;
  homeClinicId?: string;
  homeClinicName?: string;
};

export type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

export type ResetPasswordRequest = {
  newPassword: string;
};
