import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { AuthUser } from "../types/index.js";
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

    if (result.requiresMfa) {
      return { requiresMfa: true, mfaToken: result.mfaToken };
    }

    persistSession(result.accessToken, result.user, setUser);
    return { requiresMfa: false };
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const session = await apiClient.verifyMfa(mfaToken, code);
    persistSession(session.accessToken, session.user, setUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } finally {
      tokenStorage.clearAccessToken();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      login,
      verifyMfa,
      logout,
    }),
    [user, isLoading, login, verifyMfa, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
