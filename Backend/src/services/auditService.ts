import type { Logger } from "../utils/logger.js";

export type AuthAuditEvent =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.login.mfa_required"
  | "auth.mfa.success"
  | "auth.mfa.failure"
  | "auth.refresh.success"
  | "auth.refresh.failure"
  | "auth.logout"
  | "auth.unauthorized"
  | "auth.forbidden"
  | "user.created"
  | "auth.password.changed"
  | "auth.password.reset";

export type AuditContext = {
  userId?: string;
  email?: string;
  clinicId?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
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
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
