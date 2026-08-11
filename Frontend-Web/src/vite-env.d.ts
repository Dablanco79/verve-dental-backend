/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /**
   * Pilot Reset feature gate.
   * Set to "true" to show the Pilot Reset page (owner_admin only).
   * Omit or set to any other value to hide the feature entirely.
   */
  readonly VITE_PILOT_RESET_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
