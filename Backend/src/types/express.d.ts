import type { AuthenticatedUser } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** Clinic scope authorized before tenant guards and RLS run. */
      authorizedClinicId?: string;
      // req.id (ReqId = string | number | object) is already provided by pino-http's
      // IncomingMessage augmentation. No additional declaration needed here.
    }
  }
}

export {};
