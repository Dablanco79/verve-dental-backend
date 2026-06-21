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
    | { requiresMfaEnrollment: true; enrollmentToken: string }
    | { requiresMfa: false }
  >;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  /**
   * Initiates MFA enrollment. Pass the enrollmentToken returned by login()
   * for forced enrollment (avoids React state timing issues — the token from
   * login() is passed directly rather than waiting for state to flush).
   * When omitted, falls back to the stored enrollmentToken state (same-render
   * voluntary enrollment from Settings > Security).
   */
  setupMfa: (enrollmentToken?: string) => Promise<MfaSetupData>;
  /**
   * Confirms enrollment with the TOTP code. Clears the stored enrollmentToken
   * on success so subsequent API calls revert to the access token path.
   */
  confirmMfaEnrollment: (code: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
