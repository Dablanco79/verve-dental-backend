import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { randomUUID } from "node:crypto";

import type { EnvConfig } from "../config/index.js";
import type { UserRepository } from "../repositories/userRepository.js";
import type { AuditService } from "./auditService.js";
import type {
  AccessTokenPayload,
  AuthenticatedUser,
  AuthTokens,
  LoginResult,
  MfaChallengePayload,
  PublicUser,
  RefreshTokenPayload,
  UserRecord,
  UserRole,
} from "../types/auth.js";
import { AppError } from "../types/errors.js";

const MFA_REQUIRED_ROLES: UserRole[] = ["owner_admin", "group_practice_manager"];
// DEV-only bypass code — never valid in production. Real TOTP wired in Module 04+.
const DEV_MFA_CODE = "000000";

type RefreshTokenRecord = {
  userId: string;
  expiresAt: Date;
};

function parseJwtPayload(value: string | jwt.JwtPayload): jwt.JwtPayload {
  if (typeof value === "string") {
    throw new AppError(401, "UNAUTHORIZED", "Invalid token");
  }

  return value;
}

export function createAuthService(
  config: EnvConfig,
  userRepository: UserRepository,
  audit: AuditService,
) {
  const refreshTokens = new Map<string, RefreshTokenRecord>();

  function toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      homeClinicId: user.homeClinicId,
      homeClinicName: user.homeClinicName,
    };
  }

  function signAccessToken(user: UserRecord): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      homeClinicId: user.homeClinicId,
      homeClinicName: user.homeClinicName,
      type: "access",
    };

    const signOptions: SignOptions = {
      expiresIn: config.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
    };

    return jwt.sign(payload, config.JWT_ACCESS_SECRET, signOptions);
  }

  function signRefreshToken(userId: string): string {
    const jti = randomUUID();
    const payload: RefreshTokenPayload = {
      sub: userId,
      jti,
      type: "refresh",
    };

    const signOptions: SignOptions = {
      expiresIn: config.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
    };

    const token = jwt.sign(payload, config.JWT_REFRESH_SECRET, signOptions);

    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    refreshTokens.set(jti, { userId, expiresAt });
    return token;
  }

  function issueTokens(user: UserRecord): AuthTokens {
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);
    const decoded = jwt.decode(accessToken) as { exp?: number; iat?: number } | null;
    const expiresIn =
      decoded?.exp && decoded.iat ? decoded.exp - decoded.iat : 900;

    return { accessToken, refreshToken, expiresIn };
  }

  function signMfaChallenge(user: UserRecord): string {
    const payload: MfaChallengePayload = {
      sub: user.id,
      type: "mfa_challenge",
    };

    return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
      expiresIn: "5m",
    });
  }

  function verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const payload = parseJwtPayload(jwt.verify(token, config.JWT_ACCESS_SECRET));

      if (payload.type !== "access") {
        throw new AppError(401, "UNAUTHORIZED", "Invalid access token");
      }

      return payload as unknown as AccessTokenPayload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(401, "UNAUTHORIZED", "Invalid access token");
    }
  }

  async function login(
    email: string,
    password: string,
    auditContext: { ipAddress?: string; userAgent?: string },
  ): Promise<LoginResult> {
    const user = await userRepository.findByEmail(email);

    if (!user?.isActive) {
      audit.logAuthEvent("auth.login.failure", {
        email,
        reason: "invalid_credentials",
        ...auditContext,
      });
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      audit.logAuthEvent("auth.login.failure", {
        email,
        userId: user.id,
        clinicId: user.homeClinicId,
        reason: "invalid_credentials",
        ...auditContext,
      });
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const publicUser = toPublicUser(user);

    if (user.mfaEnabled && MFA_REQUIRED_ROLES.includes(user.role)) {
      audit.logAuthEvent("auth.login.mfa_required", {
        userId: user.id,
        email: user.email,
        clinicId: user.homeClinicId,
        ...auditContext,
      });

      return {
        kind: "mfa_required",
        mfaToken: signMfaChallenge(user),
        user: publicUser,
      };
    }

    const tokens = issueTokens(user);

    audit.logAuthEvent("auth.login.success", {
      userId: user.id,
      email: user.email,
      clinicId: user.homeClinicId,
      ...auditContext,
    });

    return {
      kind: "authenticated",
      tokens,
      user: publicUser,
    };
  }

  async function verifyMfa(
    mfaToken: string,
    code: string,
    auditContext: { ipAddress?: string; userAgent?: string },
  ): Promise<{ tokens: AuthTokens; user: PublicUser }> {
    let payload: MfaChallengePayload;

    try {
      const decoded = parseJwtPayload(jwt.verify(mfaToken, config.JWT_ACCESS_SECRET));

      if (decoded.type !== "mfa_challenge") {
        throw new AppError(401, "INVALID_MFA_TOKEN", "Invalid MFA challenge token");
      }

      payload = decoded as unknown as MfaChallengePayload;
    } catch {
      audit.logAuthEvent("auth.mfa.failure", {
        reason: "invalid_mfa_token",
        ...auditContext,
      });
      throw new AppError(401, "INVALID_MFA_TOKEN", "Invalid MFA challenge token");
    }

    const isValidCode = config.NODE_ENV !== "production" && code === DEV_MFA_CODE;

    if (!isValidCode) {
      audit.logAuthEvent("auth.mfa.failure", {
        userId: payload.sub,
        reason: "invalid_mfa_code",
        ...auditContext,
      });
      throw new AppError(401, "INVALID_MFA_CODE", "Invalid MFA code");
    }

    const user = await userRepository.findById(payload.sub);

    if (!user?.isActive) {
      throw new AppError(401, "INVALID_MFA_TOKEN", "Invalid MFA challenge token");
    }

    const tokens = issueTokens(user);

    audit.logAuthEvent("auth.mfa.success", {
      userId: user.id,
      email: user.email,
      clinicId: user.homeClinicId,
      ...auditContext,
    });

    return { tokens, user: toPublicUser(user) };
  }

  async function refresh(
    refreshToken: string,
    auditContext: { ipAddress?: string; userAgent?: string },
  ): Promise<{ tokens: AuthTokens; user: PublicUser }> {
    try {
      const payload = parseJwtPayload(jwt.verify(refreshToken, config.JWT_REFRESH_SECRET));

      if (payload.type !== "refresh" || typeof payload.jti !== "string") {
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
      }

      const refreshPayload = payload as unknown as RefreshTokenPayload;
      const stored = refreshTokens.get(refreshPayload.jti);

      if (!stored || stored.userId !== refreshPayload.sub) {
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
      }

      const user = await userRepository.findById(stored.userId);

      if (!user?.isActive) {
        refreshTokens.delete(refreshPayload.jti);
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
      }

      refreshTokens.delete(refreshPayload.jti);
      const tokens = issueTokens(user);

      audit.logAuthEvent("auth.refresh.success", {
        userId: user.id,
        email: user.email,
        clinicId: user.homeClinicId,
        ...auditContext,
      });

      return { tokens, user: toPublicUser(user) };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      audit.logAuthEvent("auth.refresh.failure", {
        reason: "invalid_refresh_token",
        ...auditContext,
      });
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
    }
  }

  function logout(
    refreshToken: string | undefined,
    auditContext: { userId?: string; ipAddress?: string; userAgent?: string },
  ): void {
    if (refreshToken) {
      try {
        const payload = parseJwtPayload(jwt.verify(refreshToken, config.JWT_REFRESH_SECRET));

        if (payload.type === "refresh" && typeof payload.jti === "string") {
          refreshTokens.delete(payload.jti);
        }
      } catch {
        // Ignore invalid tokens on logout.
      }
    }

    audit.logAuthEvent("auth.logout", auditContext);
  }

  function authenticateAccessToken(token: string): AuthenticatedUser {
    const payload = verifyAccessToken(token);

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      homeClinicId: payload.homeClinicId,
      homeClinicName: payload.homeClinicName,
    };
  }

  function canAccessClinic(user: AuthenticatedUser, clinicId: string): boolean {
    if (user.role === "owner_admin") {
      return true;
    }

    return user.homeClinicId === clinicId;
  }

  return {
    login,
    verifyMfa,
    refresh,
    logout,
    authenticateAccessToken,
    canAccessClinic,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
