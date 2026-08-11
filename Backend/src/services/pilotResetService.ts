/**
 * Pilot Reset Service
 *
 * Orchestrates preview and execute flows for the Pilot Reset Utility.
 *
 * SAFETY GUARANTEES
 * ─────────────────
 * • Every execute call is validated before any destructive DB work:
 *     1. PILOT_RESET_ENABLED must be true (enforced at route level too)
 *     2. Authenticated owner_admin (enforced at route level)
 *     3. Valid unexpired preview nonce (checked here)
 *     4. Nonce clinic + mode must match request
 *     5. Fresh TOTP/MFA code (verified against user's stored secret)
 *     6. Exact typed confirmation phrase
 *     7. No active blockers
 * • All destructive SQL runs in ONE explicit PostgreSQL transaction.
 * • On ANY error, the transaction is rolled back.
 * • Preview nonces are invalidated after first execute attempt.
 * • MFA codes are NEVER logged or stored.
 */

import { randomUUID } from "node:crypto";
import { verifySync } from "otplib";

import type { EnvConfig } from "../config/index.js";
import type { DatabasePool } from "../db/pool.js";
import type { RedisClient } from "../redis/client.js";
import { withTenantContext } from "../db/tenantContext.js";
import { decryptTotpSecret } from "../utils/mfaCrypto.js";
import { AppError } from "../types/errors.js";
import type { UserRepository } from "../repositories/userRepository.js";
import type { AnalyticsRepository } from "../repositories/analyticsRepository.js";
import type { AuditService } from "./auditService.js";
import type { PilotResetRepository } from "../repositories/pilotResetRepository.postgres.js";
import type {
  PilotResetMode,
  PilotResetPreviewResponse,
  PilotResetExecuteResponse,
  PreviewNonceData,
} from "../types/pilotReset.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const PREVIEW_NONCE_TTL_SECONDS = 300; // 5 minutes

const PRESERVED_OPERATIONAL = [
  "Clinic",
  "Users",
  "Roles & Permissions",
  "MFA / Security Setup",
  "Global Suppliers",
  "Master Products",
  "Clinic Products & Configuration",
  "Preferred Suppliers",
  "Reorder Points",
  "Supplier Relationships & Contracts",
  "Procurement Policies",
  "Canonical Categories",
  "Audit Events",
  "Workforce (Roster / Timesheets / Leave)",
  "AR / Billing Records",
  "Schema Migrations",
];

const PRESERVED_FULL_PILOT = [
  "Clinic",
  "Users",
  "Roles & Permissions",
  "MFA / Security Setup",
  "Global Suppliers (master directory)",
  "Master Products (global catalog)",
  "Canonical Categories",
  "Audit Events",
  "Workforce (Roster / Timesheets / Leave)",
  "AR / Billing Records",
  "Schema Migrations",
];

// ─── Nonce store (Redis-first, in-memory fallback) ───────────────────────────

type NonceEntry = { data: string; expiresAt: number };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generates the exact confirmation phrase for a clinic name. */
export function buildConfirmationPhrase(clinicName: string): string {
  return `RESET ${clinicName.toUpperCase()} PILOT DATA`;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPilotResetService(
  pilotResetRepository: PilotResetRepository,
  userRepository: UserRepository,
  analyticsRepository: AnalyticsRepository,
  auditService: AuditService,
  config: EnvConfig,
  pool: DatabasePool | null,
  redisClient: RedisClient | null,
) {
  // In-memory fallback nonce store when Redis is unavailable
  const nonceStore = new Map<string, NonceEntry>();

  // ─── Nonce helpers ─────────────────────────────────────────────────────────

  async function saveNonce(token: string, data: PreviewNonceData): Promise<void> {
    const serialized = JSON.stringify(data);
    if (redisClient) {
      await redisClient.set(`pilot_reset_nonce:${token}`, serialized, "EX", PREVIEW_NONCE_TTL_SECONDS);
    } else {
      const expiresAt = Date.now() + PREVIEW_NONCE_TTL_SECONDS * 1000;
      nonceStore.set(token, { data: serialized, expiresAt });
    }
  }

  async function getNonce(token: string): Promise<PreviewNonceData | null> {
    let raw: string | null;
    if (redisClient) {
      raw = await redisClient.get(`pilot_reset_nonce:${token}`);
    } else {
      const entry = nonceStore.get(token);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        nonceStore.delete(token);
        return null;
      }
      raw = entry.data;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PreviewNonceData;
    } catch {
      return null;
    }
  }

  async function deleteNonce(token: string): Promise<void> {
    if (redisClient) {
      await redisClient.del(`pilot_reset_nonce:${token}`);
    } else {
      nonceStore.delete(token);
    }
  }

  async function markNonceUsed(token: string, data: PreviewNonceData): Promise<void> {
    const updated: PreviewNonceData = { ...data, used: true };
    const serialized = JSON.stringify(updated);
    if (redisClient) {
      // Keep remaining TTL — just update the value
      const ttl = await redisClient.ttl(`pilot_reset_nonce:${token}`);
      const remaining = ttl > 0 ? ttl : 30;
      await redisClient.set(`pilot_reset_nonce:${token}`, serialized, "EX", remaining);
    } else {
      const entry = nonceStore.get(token);
      if (entry) {
        nonceStore.set(token, { data: serialized, expiresAt: entry.expiresAt });
      }
    }
  }

  // ─── TOTP step-up verification ─────────────────────────────────────────────

  async function verifyMfaStepUp(userId: string, mfaCode: string): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "User not found");
    }
    if (!user.mfaEnabled || !user.totpSecret) {
      throw new AppError(
        403,
        "MFA_REQUIRED",
        "MFA enrollment is required before executing a Pilot Reset",
      );
    }
    let plaintextSecret: string | null = null;
    try {
      plaintextSecret = decryptTotpSecret(user.totpSecret, config.MFA_ENCRYPTION_KEY);
    } catch {
      throw new AppError(500, "INTERNAL_ERROR", "Failed to decrypt MFA secret");
    }
    const isValid = !!plaintextSecret && verifySync({ token: mfaCode, secret: plaintextSecret }).valid;
    if (!isValid) {
      throw new AppError(401, "INVALID_MFA_CODE", "Invalid MFA code for Pilot Reset execution");
    }
  }

  // ─── Public methods ────────────────────────────────────────────────────────

  return {
    async preview(input: {
      clinicId: string;
      mode: PilotResetMode;
      actorUserId: string;
      actorEmail: string;
    }): Promise<PilotResetPreviewResponse> {
      const { clinicId, mode, actorUserId, actorEmail } = input;

      // Verify clinic exists
      const clinic = await pilotResetRepository.findClinicById(clinicId);
      if (!clinic) {
        throw new AppError(404, "NOT_FOUND", `Clinic ${clinicId} not found`);
      }

      // Check active blockers
      const blockers = await pilotResetRepository.checkActiveBlockers(clinicId);

      // Get delete counts (read-only)
      const deleteCounts = await pilotResetRepository.getPreviewCounts(clinicId, mode);

      // Orphan master product candidates (full pilot only)
      const orphanCandidates =
        mode === "full_pilot"
          ? await pilotResetRepository.getOrphanMasterProductCandidates(clinicId)
          : 0;

      // Warnings
      const warnings: string[] = [];
      if (mode === "full_pilot" && orphanCandidates > 0) {
        warnings.push(
          `${String(orphanCandidates)} Master Product(s) would become globally unreferenced after this reset. ` +
          `They are preserved — use a dedicated cleanup action to remove them.`,
        );
      }
      if (deleteCounts.clinicInventoryItemsSoftZeroed > 0) {
        warnings.push(
          `${String(deleteCounts.clinicInventoryItemsSoftZeroed)} clinic product(s) cannot be fully deleted because ` +
          `they are referenced by append-only inventory adjustment records. ` +
          `Their quantities and configuration will be zeroed/cleared instead.`,
        );
      }

      // Generate nonce
      const previewToken = randomUUID();
      const expiresAt = Date.now() + PREVIEW_NONCE_TTL_SECONDS * 1000;
      const nonceData: PreviewNonceData = {
        clinicId,
        clinicName: clinic.name,
        mode,
        expiresAt,
        used: false,
      };
      await saveNonce(previewToken, nonceData);

      // Audit: pilot_reset.previewed (non-blocking)
      auditService.logEvent("pilot_reset.previewed", {
        userId: actorUserId,
        email: actorEmail,
        clinicId,
        resourceId: clinicId,
        reason: `mode=${mode}`,
      });

      return {
        clinic,
        mode,
        deleteCounts,
        orphanCounts: { orphanMasterProductCandidates: orphanCandidates },
        preserved: mode === "operational" ? PRESERVED_OPERATIONAL : PRESERVED_FULL_PILOT,
        blockers,
        warnings,
        previewExpiresAt: new Date(expiresAt).toISOString(),
        previewToken,
        expectedConfirmationPhrase: buildConfirmationPhrase(clinic.name),
      };
    },

    async execute(input: {
      clinicId: string;
      mode: PilotResetMode;
      previewToken: string;
      mfaCode: string;
      confirmationPhrase: string;
      actorUserId: string;
      actorEmail: string;
    }): Promise<PilotResetExecuteResponse> {
      const { clinicId, mode, previewToken, mfaCode, confirmationPhrase, actorUserId, actorEmail } = input;

      // 1. Validate preview nonce
      const nonce = await getNonce(previewToken);
      if (!nonce) {
        throw new AppError(
          400,
          "INVALID_PREVIEW_TOKEN",
          "Preview token is invalid or has expired. Run preview again before executing.",
        );
      }
      if (nonce.used) {
        throw new AppError(
          400,
          "PREVIEW_TOKEN_USED",
          "This preview token has already been used. Run preview again to get a fresh token.",
        );
      }
      if (nonce.clinicId !== clinicId) {
        throw new AppError(
          400,
          "PREVIEW_TOKEN_CLINIC_MISMATCH",
          "Preview token clinic does not match requested clinic.",
        );
      }
      if (nonce.mode !== mode) {
        throw new AppError(
          400,
          "PREVIEW_TOKEN_MODE_MISMATCH",
          "Preview token reset mode does not match requested mode.",
        );
      }
      if (nonce.expiresAt <= Date.now()) {
        await deleteNonce(previewToken);
        throw new AppError(
          400,
          "PREVIEW_TOKEN_EXPIRED",
          "Preview token has expired. Run preview again before executing.",
        );
      }

      // 2. Invalidate nonce immediately — prevent duplicate execution
      await markNonceUsed(previewToken, nonce);

      // 3. Verify MFA step-up (NEVER log mfaCode)
      await verifyMfaStepUp(actorUserId, mfaCode);

      // 4. Verify exact confirmation phrase
      const expectedPhrase = buildConfirmationPhrase(nonce.clinicName);
      if (confirmationPhrase !== expectedPhrase) {
        throw new AppError(
          400,
          "CONFIRMATION_PHRASE_MISMATCH",
          "Confirmation phrase does not match. No data was deleted.",
        );
      }

      // 5. Verify clinic still exists
      const clinic = await pilotResetRepository.findClinicById(clinicId);
      if (!clinic) {
        throw new AppError(404, "NOT_FOUND", `Clinic ${clinicId} not found`);
      }

      // 6. Re-check active blockers before destructive work
      const blockers = await pilotResetRepository.checkActiveBlockers(clinicId);
      if (blockers.length > 0) {
        throw new AppError(
          409,
          "ACTIVE_PROCESS_BLOCKER",
          `Cannot reset: ${blockers.map((b) => b.message).join(" ")}`,
        );
      }

      // 7. Audit: pilot_reset.started
      auditService.logEvent("pilot_reset.started", {
        userId: actorUserId,
        email: actorEmail,
        clinicId,
        resourceId: clinicId,
        reason: `mode=${mode}`,
      });

      // 8. Execute within a single PostgreSQL transaction
      let deletedCounts: import("../types/pilotReset.js").PilotResetDeleteCounts;
      let auditEventId: string;

      if (!pool) {
        // In-memory / no-DB mode — return zero counts (used in tests)
        const zeroCounts = await pilotResetRepository.executeOperationalReset(
          {} as import("pg").PoolClient,
          clinicId,
        );
        deletedCounts = zeroCounts;
        auditEventId = randomUUID();
      } else {
        try {
          deletedCounts = await withTenantContext(
            pool,
            clinicId,
            async (client) => {
              const counts =
                mode === "operational"
                  ? await pilotResetRepository.executeOperationalReset(client, clinicId)
                  : await pilotResetRepository.executeFullPilotReset(client, clinicId);
              return counts;
            },
            true, // ownerAdmin = true
          );
        } catch (err) {
          // Audit: pilot_reset.failed
          auditService.logEvent("pilot_reset.failed", {
            userId: actorUserId,
            email: actorEmail,
            clinicId,
            resourceId: clinicId,
            reason: err instanceof Error ? err.message : "unknown error",
          });
          throw err;
        }

        // 9. Persist audit event for post-reset validation reference
        const auditResult = await analyticsRepository.recordEventAdmin({
          clinicId,
          entityType: "auth",
          entityId: clinicId,
          action: "pilot_reset.executed",
          actorId: actorUserId,
          actorEmail,
          metadata: {
            mode,
            clinicName: clinic.name,
            deletedCounts,
          },
        });
        auditEventId = auditResult.id;
      }

      // 10. Post-reset validation (after COMMIT)
      const postResetChecks = await pilotResetRepository.verifyPostReset(
        pool ?? ({} as DatabasePool),
        clinicId,
        mode,
        auditEventId,
      );

      // 11. Audit: pilot_reset.executed (logger + fire-and-forget DB persist)
      auditService.logEvent("pilot_reset.executed", {
        userId: actorUserId,
        email: actorEmail,
        clinicId,
        resourceId: clinicId,
        reason: `mode=${mode} auditRef=${auditEventId}`,
      });

      return {
        clinic,
        mode,
        deletedCounts,
        preserved: mode === "operational" ? PRESERVED_OPERATIONAL : PRESERVED_FULL_PILOT,
        postResetChecks,
        auditReference: auditEventId,
        completedAt: new Date().toISOString(),
      };
    },
  };
}

export type PilotResetService = ReturnType<typeof createPilotResetService>;
