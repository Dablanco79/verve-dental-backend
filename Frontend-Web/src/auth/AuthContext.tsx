import {
  createContext,
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

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ requiresMfa: boolean; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

const apiClient = createApiClient(loadConfig());

function persistSession(
  accessToken: string,
  refreshToken: string,
  user: AuthUser,
  setUser: (user: AuthUser) => void,
): void {
  tokenStorage.setTokens(accessToken, refreshToken);
  setUser(user);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession(): Promise<void> {
      const accessToken = tokenStorage.getAccessToken();
      const refreshToken = tokenStorage.getRefreshToken();

      if (!accessToken && !refreshToken) {
        if (!cancelled) {
          setIsLoading(false);
        }
        return;
      }

      try {
        if (accessToken) {
          const currentUser = await apiClient.getMe(accessToken);
          if (!cancelled) {
            setUser(currentUser);
          }
          return;
        }

        if (refreshToken) {
          const session = await apiClient.refresh(refreshToken);
          if (!cancelled) {
            persistSession(
              session.accessToken,
              session.refreshToken,
              session.user,
              setUser,
            );
          }
        }
      } catch {
        tokenStorage.clearTokens();
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

    persistSession(result.accessToken, result.refreshToken, result.user, setUser);
    return { requiresMfa: false };
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const session = await apiClient.verifyMfa(mfaToken, code);
    persistSession(session.accessToken, session.refreshToken, session.user, setUser);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = tokenStorage.getRefreshToken();

    try {
      await apiClient.logout(refreshToken);
    } finally {
      tokenStorage.clearTokens();
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
