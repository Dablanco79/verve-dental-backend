import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { AuthUser, MfaSetupData } from "../types/index.js";
import * as tokenStorage from "./tokenStorage.js";
import { decodeTokenIssuedAt, decodeTokenPermissions } from "./tokenUtils.js";
import { AuthContext } from "./AuthContext.js";
import type { AuthContextValue } from "./AuthContext.js";
import { redirectToLogin } from "./authNavigation.js";

const apiClient = createApiClient(loadConfig());
const SESSION_EXPIRED_EVENT = "verve:session-expired";

/**
 * Idle timeout in milliseconds.  After this period of no user interaction the
 * session is explicitly invalidated and the user is redirected to the login
 * screen.  Defaults to 60 minutes.  Can be overridden by setting
 * VITE_IDLE_TIMEOUT_MINUTES at build time.
 */
const IDLE_TIMEOUT_MS = (() => {
  const raw: unknown = import.meta.env.VITE_IDLE_TIMEOUT_MINUTES;
  const parsed = typeof raw === "string" ? parseFloat(raw) : NaN;
  return (isNaN(parsed) || parsed <= 0 ? 60 : parsed) * 60 * 1000;
})();

const IDLE_ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;
const SERVER_ACTIVITY_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function persistSession(
  accessToken: string,
  user: AuthUser,
  setUser: (user: AuthUser) => void,
  markUserActivity: boolean,
): void {
  tokenStorage.setAccessToken(accessToken);
  if (markUserActivity) {
    tokenStorage.setLastUserActivityAt();
  }
  // Merge token-level permissions (full union of defaults + explicit grants)
  // into the user object before committing to React state.  The response body
  // `user` carries only DEFAULT_PERMISSIONS[role]; explicit module grants are
  // baked into the token by issueTokens() and must be read from the JWT.
  const tokenPermissions = decodeTokenPermissions(accessToken);
  setUser({
    ...user,
    permissions: tokenPermissions.length > 0 ? tokenPermissions : user.permissions,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Stored in React state (memory only) — never persisted to localStorage.
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastServerActivitySyncRef = useRef(0);

  const clearClientSession = useCallback(() => {
    tokenStorage.clearAccessToken();
    tokenStorage.clearLastUserActivityAt();
    setUser(null);
    setEnrollmentToken(null);
  }, []);

  const logout = useCallback(async () => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    try {
      await apiClient.logout();
    } finally {
      clearClientSession();
    }
  }, [clearClientSession]);

  const expireSession = useCallback((): Promise<void> => {
    // Fail closed immediately; revocation is best-effort and must not leave an
    // expired session visible while a slow or offline network request settles.
    clearClientSession();
    window.sessionStorage.setItem("verve.sessionExpired", "1");
    // Initiate server-side revocation before notifying listeners. Navigation
    // must not block on a slow or offline request, so revocation remains
    // best-effort after it has been started.
    void apiClient.logout().catch(() => undefined);
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    return Promise.resolve();
  }, [clearClientSession]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession(): Promise<void> {
      const accessToken = tokenStorage.getAccessToken();
      let lastUserActivityAt = tokenStorage.getLastUserActivityAt();

      // Backward-compatible rollout: a recent legacy access token can seed the
      // persisted timestamp once. Missing/old evidence fails closed rather than
      // allowing an unknown-age cookie to restore an unattended session.
      if (lastUserActivityAt === null && accessToken) {
        const issuedAt = decodeTokenIssuedAt(accessToken);
        if (issuedAt !== null && Date.now() - issuedAt < IDLE_TIMEOUT_MS) {
          lastUserActivityAt = issuedAt;
          tokenStorage.setLastUserActivityAt(issuedAt);
        }
      }

      if (lastUserActivityAt === null && !accessToken) {
        // Cookie-only legacy sessions have no trustworthy browser activity
        // evidence. Revoke them without presenting an expiry warning to a
        // genuinely signed-out visitor.
        await Promise.resolve()
          .then(() => apiClient.logout())
          .catch(() => undefined);
        clearClientSession();
        if (!cancelled) setIsLoading(false);
        return;
      }

      if (
        lastUserActivityAt === null ||
        Date.now() - lastUserActivityAt >= IDLE_TIMEOUT_MS
      ) {
        await expireSession();
        if (!cancelled) setIsLoading(false);
        return;
      }

      try {
        if (accessToken) {
          try {
            const currentUser = await apiClient.getMe(accessToken);
            if (!cancelled) {
              setUser(currentUser);
            }
            return;
          } catch {
            tokenStorage.clearAccessToken();
            const session = await apiClient.refresh();
            if (!cancelled) {
              persistSession(session.accessToken, session.user, setUser, false);
            }
            return;
          }
        }

        // No stored access token — attempt silent refresh via HttpOnly cookie.
        // If there is no valid cookie the request will 401 and we catch below.
        const session = await apiClient.refresh();
        if (!cancelled) {
          persistSession(session.accessToken, session.user, setUser, false);
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
  }, [clearClientSession, expireSession]);

  useEffect(() => {
    function handleSessionExpired(): void {
      clearClientSession();
      redirectToLogin();
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [clearClientSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiClient.login(email, password);

    // Narrow the enrollment case first. Early return ensures TypeScript removes
    // this variant from the type for subsequent checks — the && would confuse
    // control-flow analysis and leave the union unsatisfied below.
    if ("requiresMfaEnrollment" in result) {
      // Store enrollment token in memory only — never in localStorage or cookies.
      // Also return it directly so callers can pass it straight to setupMfa()
      // without waiting for the React state update to flush.
      setEnrollmentToken(result.enrollmentToken);
      return { requiresMfaEnrollment: true as const, enrollmentToken: result.enrollmentToken };
    }

    // result is now { requiresMfa: false; ... } | { requiresMfa: true; ... }
    if (result.requiresMfa) {
      return { requiresMfa: true as const, mfaToken: result.mfaToken };
    }

    persistSession(result.accessToken, result.user, setUser, true);
    return { requiresMfa: false as const };
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const session = await apiClient.verifyMfa(mfaToken, code);
    persistSession(session.accessToken, session.user, setUser, true);
  }, []);

  const setupMfa = useCallback(async (token?: string): Promise<MfaSetupData> => {
    // Prefer a directly-passed token (avoids React state timing issues when
    // called immediately after login()). Fall back to the stored enrollmentToken
    // state, then the access token for voluntary enrollment from Settings.
    return apiClient.setupMfa(token ?? enrollmentToken ?? undefined);
  }, [enrollmentToken]);

  const confirmMfaEnrollment = useCallback(async (code: string): Promise<void> => {
    await apiClient.confirmMfa(code, enrollmentToken ?? undefined);
    // Clear the enrollment token after successful confirmation regardless of
    // whether it was forced (login) or voluntary (settings page).
    setEnrollmentToken(null);
  }, [enrollmentToken]);

  // ── Idle timeout ──────────────────────────────────────────────────────────
  // Only active while a user is logged in.  Each user-interaction event resets
  // the timer.  When the timer fires the session is explicitly invalidated so
  // the HttpOnly refresh cookie cannot silently restore it on next page load.
  useEffect(() => {
    if (!user) return;

    function scheduleExpiry(lastUserActivityAt: number): void {
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      const remainingMs = IDLE_TIMEOUT_MS - (Date.now() - lastUserActivityAt);
      if (remainingMs <= 0) {
        void expireSession();
        return;
      }
      idleTimerRef.current = setTimeout(() => {
        void expireSession();
      }, remainingMs);
    }

    function recordGenuineActivity(event?: Event): void {
      if (event && !event.isTrusted && import.meta.env.MODE !== "test") return;
      const previousActivityAt = tokenStorage.getLastUserActivityAt();
      if (
        previousActivityAt === null ||
        Date.now() - previousActivityAt >= IDLE_TIMEOUT_MS
      ) {
        void expireSession();
        return;
      }

      const now = Date.now();
      tokenStorage.setLastUserActivityAt(now);
      scheduleExpiry(now);

      if (
        now - lastServerActivitySyncRef.current >=
        SERVER_ACTIVITY_SYNC_INTERVAL_MS
      ) {
        lastServerActivitySyncRef.current = now;
        // A network failure must not convert local activity into a logout.
        // The server remains authoritative and will reject a stale refresh.
        void apiClient.recordActivity().catch(() => undefined);
      }
    }

    function handleVisibilityChange(event: Event): void {
      if (document.visibilityState === "visible") {
        recordGenuineActivity(event);
      }
    }

    function handleStorage(event: StorageEvent): void {
      if (event.key === tokenStorage.ACCESS_TOKEN_KEY && event.newValue === null) {
        clearClientSession();
        redirectToLogin();
        return;
      }
      if (event.key === tokenStorage.LAST_USER_ACTIVITY_KEY && event.newValue) {
        const timestamp = Number(event.newValue);
        if (Number.isFinite(timestamp) && timestamp > 0) {
          scheduleExpiry(timestamp);
        }
      }
    }

    const persistedActivityAt = tokenStorage.getLastUserActivityAt();
    if (persistedActivityAt === null) {
      void expireSession();
      return;
    }
    scheduleExpiry(persistedActivityAt);

    for (const event of IDLE_ACTIVITY_EVENTS) {
      window.addEventListener(event, recordGenuineActivity, { passive: true });
    }
    window.addEventListener("focus", recordGenuineActivity);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      for (const event of IDLE_ACTIVITY_EVENTS) {
        window.removeEventListener(event, recordGenuineActivity);
      }
      window.removeEventListener("focus", recordGenuineActivity);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user, clearClientSession, expireSession]);

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
