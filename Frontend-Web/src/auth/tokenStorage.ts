export const ACCESS_TOKEN_KEY = "verve.accessToken";
export const LAST_USER_ACTIVITY_KEY = "verve.lastUserActivityAt";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(accessToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

export function clearAccessToken(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function getLastUserActivityAt(): number | null {
  const value = localStorage.getItem(LAST_USER_ACTIVITY_KEY);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function setLastUserActivityAt(timestamp = Date.now()): void {
  localStorage.setItem(LAST_USER_ACTIVITY_KEY, String(timestamp));
}

export function clearLastUserActivityAt(): void {
  localStorage.removeItem(LAST_USER_ACTIVITY_KEY);
}
