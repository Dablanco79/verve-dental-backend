export type AppConfig = {
  apiBaseUrl: string;
  /**
   * When true, the Pilot Reset utility is visible to owner_admin users.
   * Controlled by VITE_PILOT_RESET_ENABLED=true in the environment.
   * Defaults to false — the feature is hidden unless explicitly enabled.
   */
  pilotResetEnabled: boolean;
};

export function loadConfig(): AppConfig {
  // Empty string means same-origin — the Vite dev proxy rewrites /api/* → backend.
  // In production this must be set to the fully-qualified API origin.
  // Cast to string | undefined: Vite types it as string, but it is genuinely absent
  // when VITE_API_BASE_URL is not declared in the environment.
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
  const pilotResetEnabled = import.meta.env.VITE_PILOT_RESET_ENABLED === "true";

  return { apiBaseUrl, pilotResetEnabled };
}
