export type AppConfig = {
  apiBaseUrl: string;
};

export function loadConfig(): AppConfig {
  // Empty string means same-origin — the Vite dev proxy rewrites /api/* → backend.
  // In production this must be set to the fully-qualified API origin.
  // Cast to string | undefined: Vite types it as string, but it is genuinely absent
  // when VITE_API_BASE_URL is not declared in the environment.
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

  return { apiBaseUrl };
}
