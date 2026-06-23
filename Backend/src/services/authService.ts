import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { generateSecret, generateURI, verifySync } from "otplib";
import { randomUUID } from "node:crypto";

import type { EnvConfig } from "../config/index.js";
import { decryptTotpSecret, encryptTotpSecret } from "../utils/mfaCrypto.js";
import type { RedisClient } from "../redis/client.js";
import type { UserRepository } from "../repositories/userRepository.js";
import type { AuditService } from "./auditService.js";
import type {
  AccessTokenPayload,
  AuthenticatedUser,
  AuthTokens,
  LoginResult,
  MfaChallengePayload,
  MfaEnrollmentPayload,
  PublicUser,
  RefreshTokenPayload,
  UserRecord,
  UserRole,
} from "../types/auth.js";
import { AppError } from "../types/errors.js";

const MFA_REQUIRED_ROLES: UserRole[] = ["owner_admin", "group_practice_manager"];

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
  redisClient: RedisClient | null = null,
) {
  // In-memory fallback store — used when Redis is unavailable (local dev / tests).
  const refreshTokens = new Map<string, RefreshTokenRecord>();

  // ---------------------------------------------------------------------------
  // Refresh-token store helpers (Redis-first, Map fallback)
  //
  // Redis key schema:
  //   refresh:{jti}          → userId string, TTL = JWT expiry seconds
  //   user_tokens:{userId}   → Redis Set of active JTIs (for bulk revocation)
  // ---------------------------------------------------------------------------

  async function saveRefreshToken(jti: string, userId: string, ttlSeconds: number): Promise<void> {
    if (redisClient) {
      // Single pipeline batch: SET the token, index the JTI into the user set,
      // and (re)set the set's TTL so stale JTIs never accumulate beyond one extra
      // hour after the most-recently-issued token expires naturally.
      await redisClient
        .pipeline()
        .set(`refresh:${jti}`, userId, "EX", ttlSeconds)
        .sadd(`user_tokens:${userId}`, jti)
        .expire(`user_tokens:${userId}`, ttlSeconds + 3600)
        .exec();
    } else {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      refreshTokens.set(jti, { userId, expiresAt });
    }
  }

  async function getRefreshTokenUserId(jti: string): Promise<string | null> {
    if (redisClient) {
      return redisClient.get(`refresh:${jti}`);
    }
    return refreshTokens.get(jti)?.userId ?? null;
  }

  async function deleteRefreshToken(jti: string, userId: string): Promise<void> {
    if (redisClient) {
      // Single pipeline batch: DEL the token key and SREM the JTI from the user
      // index together, reducing the partial-failure window vs. two sequential awaits.
      await redisClient
        .pipeline()
        .del(`refresh:${jti}`)
        .srem(`user_tokens:${userId}`, jti)
        .exec();
    } else {
      refreshTokens.delete(jti);
    }
  }

  // ---------------------------------------------------------------------------
  // Pending MFA enrollment secret store (Redis-first, Map fallback)
  //
  // Redis key schema:
  //   pending_mfa:{userId}   → base32 TOTP secret string, TTL = 10 minutes
  //
  // The secret is stored only until the user submits a valid first TOTP code
  // to POST /auth/mfa/confirm.  On success the secret is persisted to the DB
  // and the pending key is deleted.  On expiry the user must call /setup again.
  // ---------------------------------------------------------------------------

  const PENDING_MFA_TTL_SECONDS = 600; // 10 minutes
  const pendingMfaSecrets = new Map<string, { secret: string; expiresAt: Date }>();

  async function savePendingMfaSecret(userId: string, secret: string): Promise<void> {
    const ciphertext = encryptTotpSecret(secret, config.MFA_ENCRYPTION_KEY);
    if (redisClient) {
      await redisClient.set(`pending_mfa:${userId}`, ciphertext, "EX", PENDING_MFA_TTL_SECONDS);
    } else {
      const expiresAt = new Date(Date.now() + PENDING_MFA_TTL_SECONDS * 1000);
      pendingMfaSecrets.set(userId, { secret: ciphertext, expiresAt });
    }
  }

  async function getPendingMfaSecret(userId: string): Promise<string | null> {
    let ciphertext: string | null;
    if (redisClient) {
      ciphertext = await redisClient.get(`pending_mfa:${userId}`);
    } else {
      const entry = pendingMfaSecrets.get(userId);
      if (!entry) return null;
      if (entry.expiresAt <= new Date()) {
        pendingMfaSecrets.delete(userId);
        return null;
      }
      ciphertext = entry.secret;
    }
    if (!ciphertext) return null;
    try {
      return decryptTotpSecret(ciphertext, config.MFA_ENCRYPTION_KEY);
    } catch {
      return null;
    }
  }

  async function deletePendingMfaSecret(userId: string): Promise<void> {
    if (redisClient) {
      await redisClient.del(`pending_mfa:${userId}`);
    } else {
      pendingMfaSecrets.delete(userId);
    }
  }

  // ---------------------------------------------------------------------------

  function toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      homeClinicId: user.homeClinicId,
      homeClinicName: user.homeClinicName,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      payrollTrack: user.payrollTrack,
    };
  }

  function signAccessToken(user: UserRecord): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      homeClinicId: user.homeClinicId,
      homeClinicName: user.homeClinicName,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      type: "access",
    };

    const signOptions: SignOptions = {
      expiresIn: config.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
    };

    return jwt.sign(payload, config.JWT_ACCESS_SECRET, signOptions);
  }

  async function signRefreshToken(userId: string): Promise<string> {
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

    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    await saveRefreshToken(jti, userId, ttlSeconds);

    return token;
  }

  async function issueTokens(user: UserRecord): Promise<AuthTokens> {
    const accessToken = signAccessToken(user);
    const refreshToken = await signRefreshToken(user.id);
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

  /**
   * Issues a short-lived (15 min) enrollment token when a privileged user
   * logs in without MFA enrolled.  The token carries the same user fields as
   * an access token but has type "mfa_enrollment", so the standard
   * authenticate middleware rejects it for all routes except
   * POST /auth/mfa/setup and POST /auth/mfa/confirm.
   */
  function signMfaEnrollmentToken(user: UserRecord): string {
    const payload: MfaEnrollmentPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      homeClinicId: user.homeClinicId,
      homeClinicName: user.homeClinicName,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      type: "mfa_enrollment",
    };

    return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: "15m" });
  }

  /**
   * Verifies an MFA enrollment token and returns the caller as an
   * AuthenticatedUser so the MFA setup/confirm handlers can identify the user.
   * Throws 401 UNAUTHORIZED on any failure.
   */
  function verifyMfaEnrollmentToken(token: string): AuthenticatedUser {
    try {
      const payload = parseJwtPayload(jwt.verify(token, config.JWT_ACCESS_SECRET));

      if (payload.type !== "mfa_enrollment") {
        throw new AppError(401, "UNAUTHORIZED", "Invalid enrollment token");
      }

      return {
        id: payload.sub as string,
        email: payload.email as string,
        role: payload.role as UserRole,
        homeClinicId: payload.homeClinicId as string,
        homeClinicName: payload.homeClinicName as string,
        firstName: (payload.firstName as string | null | undefined) ?? null,
        lastName: (payload.lastName as string | null | undefined) ?? null,
        displayName: (payload.displayName as string | null | undefined) ?? null,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "UNAUTHORIZED", "Invalid or expired enrollment token");
    }
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

    if (MFA_REQUIRED_ROLES.includes(user.role)) {
      if (user.mfaEnabled) {
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

      // Privileged user with mfa_enabled = false — do not issue tokens.
      audit.logAuthEvent("auth.login.mfa_enrollment_required", {
        userId: user.id,
        email: user.email,
        clinicId: user.homeClinicId,
        role: user.role,
        ...auditContext,
      });

      return {
        kind: "mfa_enrollment_required",
        enrollmentToken: signMfaEnrollmentToken(user),
        user: publicUser,
      };
    }

    const tokens = await issueTokens(user);

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

    const user = await userRepository.findById(payload.sub);

    if (!user?.isActive) {
      throw new AppError(401, "INVALID_MFA_TOKEN", "Invalid MFA challenge token");
    }

    const plaintextSecret = user.totpSecret
      ? decryptTotpSecret(user.totpSecret, config.MFA_ENCRYPTION_KEY)
      : null;

    const isValidCode =
      !!plaintextSecret &&
      verifySync({ token: code, secret: plaintextSecret }).valid;

    if (!isValidCode) {
      audit.logAuthEvent("auth.mfa.failure", {
        userId: payload.sub,
        reason: "invalid_mfa_code",
        ...auditContext,
      });
      throw new AppError(401, "INVALID_MFA_CODE", "Invalid MFA code");
    }

    const tokens = await issueTokens(user);

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
      const storedUserId = await getRefreshTokenUserId(refreshPayload.jti);

      if (!storedUserId || storedUserId !== refreshPayload.sub) {
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
      }

      const user = await userRepository.findById(storedUserId);

      if (!user?.isActive) {
        await deleteRefreshToken(refreshPayload.jti, refreshPayload.sub);
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
      }

      // Enforce MFA enrollment on refresh: a privileged user who somehow holds
      // a refresh token (e.g. token pre-dates enforcement) cannot silently
      // bypass the requirement by skipping the login gate.
      if (!user.mfaEnabled && MFA_REQUIRED_ROLES.includes(user.role)) {
        await deleteRefreshToken(refreshPayload.jti, refreshPayload.sub);
        audit.logAuthEvent("auth.refresh.mfa_enrollment_required", {
          userId: user.id,
          email: user.email,
          clinicId: user.homeClinicId,
          role: user.role,
          ...auditContext,
        });
        throw new AppError(403, "MFA_ENROLLMENT_REQUIRED", "MFA enrollment is required for your role");
      }

      await deleteRefreshToken(refreshPayload.jti, refreshPayload.sub);
      const tokens = await issueTokens(user);

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

  async function logout(
    refreshToken: string | undefined,
    auditContext: { userId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    if (refreshToken) {
      try {
        const payload = parseJwtPayload(jwt.verify(refreshToken, config.JWT_REFRESH_SECRET));

        if (
          payload.type === "refresh" &&
          typeof payload.jti === "string" &&
          typeof payload.sub === "string"
        ) {
          await deleteRefreshToken(payload.jti, payload.sub);
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
      // Name fields were added in Sprint 1; older JWTs may not carry them.
      firstName: payload.firstName ?? null,
      lastName: payload.lastName ?? null,
      displayName: payload.displayName ?? null,
    };
  }

  function canAccessClinic(user: AuthenticatedUser, clinicId: string): boolean {
    if (user.role === "owner_admin") {
      return true;
    }

    return user.homeClinicId === clinicId;
  }

  /**
   * Revokes all refresh tokens belonging to a user.
   * With Redis: reads the per-user JTI set, deletes each token key, then deletes the set.
   * With Map fallback: iterates the in-memory map and removes matching entries.
   * Called after a password change or admin reset so existing sessions are
   * invalidated and the user must log in again with the new credentials.
   */
  async function revokeAllUserTokens(userId: string): Promise<void> {
    if (redisClient) {
      const jtis = await redisClient.smembers(`user_tokens:${userId}`);
      // Build a single pipeline batch for all deletes so they are sent in one
      // round-trip, shrinking the partial-failure window vs. Promise.all with
      // independent awaits.
      const pipe = redisClient.pipeline();
      for (const jti of jtis) {
        pipe.del(`refresh:${jti}`);
      }
      pipe.del(`user_tokens:${userId}`);
      await pipe.exec();
    } else {
      for (const [jti, record] of refreshTokens) {
        if (record.userId === userId) {
          refreshTokens.delete(jti);
        }
      }
    }
  }

  async function changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    auditContext: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const user = await userRepository.findById(userId);

    if (!user?.isActive) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!passwordMatches) {
      audit.logAuthEvent("auth.password.changed", {
        userId,
        email: user.email,
        clinicId: user.homeClinicId,
        reason: "wrong_current_password",
        ...auditContext,
      });
      throw new AppError(400, "INVALID_CREDENTIALS", "Current password is incorrect");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await userRepository.updatePassword(userId, hashedPassword);
    await revokeAllUserTokens(userId);

    audit.logAuthEvent("auth.password.changed", {
      userId,
      email: user.email,
      clinicId: user.homeClinicId,
      ...auditContext,
    });
  }

  /**
   * Begins TOTP enrollment for the authenticated user.
   *
   * Generates a fresh Base32 TOTP secret, stores it as a pending enrollment
   * in Redis (or in-memory fallback) with a 10-minute TTL, and returns the
   * secret plus an otpauth:// URI that authenticator apps can scan as a QR code.
   *
   * The secret is NOT written to the database yet — that only happens when the
   * user confirms with a valid TOTP code via confirmMfa().
   */
  async function setupMfa(
    userId: string,
    auditContext: { ipAddress?: string; userAgent?: string },
  ): Promise<{ secret: string; uri: string }> {
    const user = await userRepository.findById(userId);

    if (!user?.isActive) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    const secret = generateSecret();

    await savePendingMfaSecret(userId, secret);

    const uri = generateURI({
      issuer: "Verve Dental",
      label: user.email,
      secret,
    });

    audit.logAuthEvent("auth.mfa.setup_initiated", {
      userId: user.id,
      email: user.email,
      clinicId: user.homeClinicId,
      ...auditContext,
    });

    return { secret, uri };
  }

  /**
   * Completes TOTP enrollment for the authenticated user.
   *
   * Loads the pending secret stored by setupMfa(), verifies the submitted TOTP
   * code against it, and on success writes the secret to users.totp_secret and
   * sets mfa_enabled = true.  The pending key is then deleted.
   *
   * Fails with 400 MFA_SETUP_REQUIRED when no pending setup exists (expired or
   * /setup was never called), and 401 INVALID_MFA_CODE when the code is wrong.
   */
  async function confirmMfa(
    userId: string,
    code: string,
    auditContext: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const user = await userRepository.findById(userId);

    if (!user?.isActive) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    const pendingSecret = await getPendingMfaSecret(userId);

    if (!pendingSecret) {
      throw new AppError(
        400,
        "MFA_SETUP_REQUIRED",
        "No pending MFA setup found — call POST /auth/mfa/setup first",
      );
    }

    const isValid = verifySync({ token: code, secret: pendingSecret }).valid;

    if (!isValid) {
      audit.logAuthEvent("auth.mfa.confirm_failure", {
        userId: user.id,
        email: user.email,
        clinicId: user.homeClinicId,
        reason: "invalid_mfa_code",
        ...auditContext,
      });
      throw new AppError(401, "INVALID_MFA_CODE", "Invalid MFA code");
    }

    const encryptedSecret = encryptTotpSecret(pendingSecret, config.MFA_ENCRYPTION_KEY);
    await userRepository.setUserMfaEnrollment(userId, encryptedSecret);
    await deletePendingMfaSecret(userId);

    audit.logAuthEvent("auth.mfa.enrolled", {
      userId: user.id,
      email: user.email,
      clinicId: user.homeClinicId,
      ...auditContext,
    });
  }

  return {
    login,
    verifyMfa,
    refresh,
    logout,
    authenticateAccessToken,
    verifyMfaEnrollmentToken,
    canAccessClinic,
    changePassword,
    revokeAllUserTokens,
    setupMfa,
    confirmMfa,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
