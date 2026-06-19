import { createContext } from "react";

import type { AuthUser, MfaSetupData } from "../types/index.js";

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  /**
   * Non-null only when a login response required MFA enrollment.
   * Stored in React state (memory only) — never in localStorage.
   */
  enrollmentToken: string | null;
  login: (
    email: string,
    password: string,
  ) => Promise<
    | { requiresMfa: true; mfaToken: string }
    | { requiresMfaEnrollment: true }
    | { requiresMfa: false }
  >;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  /**
   * Initiates MFA enrollment. Uses the stored enrollmentToken when present
   * (forced enrollment at login); otherwise uses the current access token
   * (voluntary enrollment from Settings > Security).
   */
  setupMfa: () => Promise<MfaSetupData>;
  /**
   * Confirms enrollment with the TOTP code. Clears the stored enrollmentToken
   * on success so subsequent API calls revert to the access token path.
   */
  confirmMfaEnrollment: (code: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
