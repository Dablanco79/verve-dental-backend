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
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
};

export type LoginResponse =
  | {
      requiresMfa: false;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: AuthUser;
    }
  | {
      requiresMfa: true;
      mfaToken: string;
      user: AuthUser;
    };

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export type StaffUser = {
  id: string;
  email: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
};

export type CreateUserRequest = {
  email: string;
  password: string;
  role: UserRole;
  clinicName: string;
};

export type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

export type ResetPasswordRequest = {
  newPassword: string;
};
