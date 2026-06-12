export const USER_ROLES = [
  "owner_admin",
  "group_practice_manager",
  "clinical_staff",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /**
   * The user's permanent payroll / contract location.
   * Distinct from the rostered_clinic_id that Roster entries will carry
   * when a staff member works at a different location on a given shift.
   */
  homeClinicId: string;
  homeClinicName: string;
  mfaEnabled: boolean;
  isActive: boolean;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
  /** Payroll / contract location — not the clinic currently being accessed via URL. */
  homeClinicId: string;
  homeClinicName: string;
};

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  homeClinicId: string;
  homeClinicName: string;
  type: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  jti: string;
  type: "refresh";
};

export type MfaChallengePayload = {
  sub: string;
  type: "mfa_challenge";
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type PublicUser = AuthenticatedUser;

export type LoginResult =
  | {
      kind: "authenticated";
      tokens: AuthTokens;
      user: PublicUser;
    }
  | {
      kind: "mfa_required";
      mfaToken: string;
      user: PublicUser;
    };
