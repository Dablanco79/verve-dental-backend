import { createContext } from "react";

import type { AuthUser } from "../types/index.js";

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ requiresMfa: boolean; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
