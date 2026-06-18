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
  | "auth.password.changed"
  | "auth.password.reset";

export type PurchaseOrderAuditEvent =
  | "purchase_order.submitted"
  | "purchase_order.csv_exported";

export type AuditEvent = AuthAuditEvent | PurchaseOrderAuditEvent;

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

export function createAuditService(logger: Logger) {
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
    },

    /** Log an internal error (non-audit, for unexpected exceptions). */
    logError(message: string, err: unknown): void {
      logger.error({ err }, message);
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
