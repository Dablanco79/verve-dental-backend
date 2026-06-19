import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { AuthUser, MfaSetupData } from "../types/index.js";
import * as tokenStorage from "./tokenStorage.js";
import { AuthContext } from "./AuthContext.js";
import type { AuthContextValue } from "./AuthContext.js";

const apiClient = createApiClient(loadConfig());

function persistSession(
  accessToken: string,
  user: AuthUser,
  setUser: (user: AuthUser) => void,
): void {
  tokenStorage.setAccessToken(accessToken);
  setUser(user);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Stored in React state (memory only) — never persisted to localStorage.
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession(): Promise<void> {
      const accessToken = tokenStorage.getAccessToken();

      try {
        if (accessToken) {
          const currentUser = await apiClient.getMe(accessToken);
          if (!cancelled) {
            setUser(currentUser);
          }
          return;
        }

        // No stored access token — attempt silent refresh via HttpOnly cookie.
        // If there is no valid cookie the request will 401 and we catch below.
        const session = await apiClient.refresh();
        if (!cancelled) {
          persistSession(session.accessToken, session.user, setUser);
        }
      } catch {
        tokenStorage.clearAccessToken();
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiClient.login(email, password);

    // Narrow the enrollment case first. Early return ensures TypeScript removes
    // this variant from the type for subsequent checks — the && would confuse
    // control-flow analysis and leave the union unsatisfied below.
    if ("requiresMfaEnrollment" in result) {
      // Store enrollment token in memory only — never in localStorage or cookies.
      setEnrollmentToken(result.enrollmentToken);
      return { requiresMfaEnrollment: true as const };
    }

    // result is now { requiresMfa: false; ... } | { requiresMfa: true; ... }
    if (result.requiresMfa) {
      return { requiresMfa: true as const, mfaToken: result.mfaToken };
    }

    persistSession(result.accessToken, result.user, setUser);
    return { requiresMfa: false as const };
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const session = await apiClient.verifyMfa(mfaToken, code);
    persistSession(session.accessToken, session.user, setUser);
  }, []);

  const setupMfa = useCallback(async (): Promise<MfaSetupData> => {
    // Use the enrollmentToken when forced enrollment is in progress,
    // otherwise fall back to the stored access token for voluntary enrollment.
    return apiClient.setupMfa(enrollmentToken ?? undefined);
  }, [enrollmentToken]);

  const confirmMfaEnrollment = useCallback(async (code: string): Promise<void> => {
    await apiClient.confirmMfa(code, enrollmentToken ?? undefined);
    // Clear the enrollment token after successful confirmation regardless of
    // whether it was forced (login) or voluntary (settings page).
    setEnrollmentToken(null);
  }, [enrollmentToken]);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } finally {
      tokenStorage.clearAccessToken();
      setUser(null);
      setEnrollmentToken(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      enrollmentToken,
      login,
      verifyMfa,
      setupMfa,
      confirmMfaEnrollment,
      logout,
    }),
    [user, isLoading, enrollmentToken, login, verifyMfa, setupMfa, confirmMfaEnrollment, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
