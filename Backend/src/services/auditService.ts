import { AUTH_BYPASS_CLINIC_ID } from "../db/tenantContext.js";
import type { AnalyticsRepository } from "../repositories/analyticsRepository.js";
import type { AuditEntityType } from "../types/analytics.js";
import type { Logger } from "../utils/logger.js";

export type AuthAuditEvent =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.login.mfa_required"
  | "auth.login.mfa_enrollment_required"
  | "auth.mfa.success"
  | "auth.mfa.failure"
  | "auth.mfa.setup_initiated"
  | "auth.mfa.confirm_failure"
  | "auth.mfa.enrolled"
  | "auth.refresh.success"
  | "auth.refresh.failure"
  | "auth.refresh.mfa_enrollment_required"
  | "auth.logout"
  | "auth.unauthorized"
  | "auth.forbidden"
  | "user.created"
  | "user.updated"
  | "user.permission.granted"
  | "user.permission.revoked"
  | "auth.password.changed"
  | "auth.password.reset";

export type PurchaseOrderAuditEvent =
  | "purchase_order.submitted"
  | "purchase_order.csv_exported";

export type SupplierAuditEvent =
  | "supplier.created"
  | "supplier.updated"
  | "supplier_product.created"
  | "supplier_product.updated"
  | "catalogue.imported";

export type MasterProductAuditEvent =
  | "master_product.imported"
  | "master_product.import_skipped"
  | "master_product.created"
  | "master_product.updated"
  | "master_product.archived"
  | "master_product.reactivated";

export type SupplierInvoiceAuditEvent =
  | "supplier_invoice.uploaded"
  | "supplier_invoice.confirmed"
  | "supplier_invoice.cancelled"
  | "supplier_invoice.voided"
  | "supplier_invoice.received";

export type AuditEvent =
  | AuthAuditEvent
  | PurchaseOrderAuditEvent
  | SupplierAuditEvent
  | SupplierInvoiceAuditEvent
  | MasterProductAuditEvent;

export type AuditContext = {
  userId?: string;
  email?: string;
  role?: string;
  clinicId?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  /** Generic resource identifier (e.g. poId for purchase order events). */
  resourceId?: string;
};

/**
 * Stable sentinel UUID used as actor_id / entity_id in audit_events rows
 * when no real user identity is available (e.g. login failure with an
 * unrecognised email).  Reuses the auth-bypass clinic ID constant so both
 * the DB and log analysts see the same recognisable nil-UUID sentinel.
 */
const SYSTEM_ACTOR_ID = AUTH_BYPASS_CLINIC_ID;

/**
 * Builds safe, non-sensitive metadata for an audit_events row.
 *
 * Deliberately omits: userId, email, clinicId (stored in dedicated columns),
 * and any value that could be a token, password, TOTP code, or raw credential.
 */
function buildSafeMetadata(context: AuditContext): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (context.ipAddress) meta.ipAddress = context.ipAddress;
  if (context.userAgent) meta.userAgent = context.userAgent;
  if (context.role) meta.role = context.role;
  if (context.reason) meta.reason = context.reason;
  if (context.resourceId) meta.resourceId = context.resourceId;
  return meta;
}

function entityTypeForEvent(event: AuditEvent): AuditEntityType {
  if (event.startsWith("supplier_invoice.")) return "invoice";
  if (
    event.startsWith("supplier_") ||
    event.startsWith("catalogue.") ||
    event.startsWith("master_product.")
  ) {
    return "product";
  }
  if (event.startsWith("purchase_order.")) return "purchase_order";
  if (event.startsWith("user.")) return "user";
  return "auth";
}

export function createAuditService(
  logger: Logger,
  analyticsRepository: AnalyticsRepository | null = null,
) {
  /**
   * Persists a security/auth event to audit_events using owner-admin DB
   * context so the INSERT succeeds even outside a normal tenant request.
   *
   * Called fire-and-forget — errors are swallowed after logging so that a DB
   * hiccup NEVER blocks or fails the authentication operation itself.
   */
  function persistAuthAuditEvent(event: AuditEvent, context: AuditContext): void {
    if (!analyticsRepository) return;

    const clinicId = context.clinicId ?? AUTH_BYPASS_CLINIC_ID;
    const actorId = context.userId ?? SYSTEM_ACTOR_ID;
    const actorEmail = context.email ?? "system";
    const entityType = event.startsWith("user.") ? "user" : "auth";
    // For user-management events the entity being modified is the resource;
    // for auth events the entity is the actor themselves.
    const entityId = context.resourceId ?? context.userId ?? SYSTEM_ACTOR_ID;

    analyticsRepository
      .recordEventAdmin({
        clinicId,
        entityType,
        entityId,
        action: event,
        actorId,
        actorEmail,
        metadata: buildSafeMetadata(context),
      })
      .catch((err: unknown) => {
        logger.error({ err, event }, "audit_events persistence failed (non-fatal)");
      });
  }

  return {
    logAuthEvent(event: AuthAuditEvent, context: AuditContext = {}): void {
      logger.info(
        {
          audit: true,
          event,
          ...context,
        },
        `Auth audit: ${event}`,
      );
      persistAuthAuditEvent(event, context);
    },

    /** Log any application-level audit event. */
    logEvent(event: AuditEvent, context: AuditContext = {}): void {
      logger.info(
        {
          audit: true,
          event,
          ...context,
        },
        `Audit: ${event}`,
      );
      if (event.startsWith("auth.") || event.startsWith("user.")) {
        persistAuthAuditEvent(event, context);
        return;
      }

      if (analyticsRepository && context.clinicId && context.resourceId) {
        analyticsRepository
          .recordEventAdmin({
            clinicId: context.clinicId,
            entityType: entityTypeForEvent(event),
            entityId: context.resourceId,
            action: event,
            actorId: context.userId ?? SYSTEM_ACTOR_ID,
            actorEmail: context.email ?? "system",
            metadata: buildSafeMetadata(context),
          })
          .catch((err: unknown) => {
            logger.error({ err, event }, "audit_events persistence failed (non-fatal)");
          });
      }
    },

    /** Log an internal error (non-audit, for unexpected exceptions). */
    logError(message: string, err: unknown): void {
      logger.error({ err }, message);
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
