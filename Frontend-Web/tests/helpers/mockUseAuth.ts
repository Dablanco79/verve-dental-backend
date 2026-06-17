import type { AuthUser } from "../../src/types/index.js";

export type AuthTestState = {
  user: AuthUser | null;
  isLoading: boolean;
};

export function setAuthenticatedUser(state: AuthTestState, user: AuthUser): void {
  state.user = user;
  state.isLoading = false;
}

export function clearAuthenticatedUser(state: AuthTestState): void {
  state.user = null;
  state.isLoading = false;
}
