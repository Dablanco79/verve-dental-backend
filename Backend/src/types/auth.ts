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
  clinicId: string;
  clinicName: string;
  mfaEnabled: boolean;
  isActive: boolean;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
};

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
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
