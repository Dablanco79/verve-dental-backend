import type { AppConfig } from "../config/index.js";
import type { HealthResponse } from "../types/index.js";

/**
 * Lightweight API client stub.
 * OpenAPI-generated client will replace this in a later module.
 */
export function createApiClient(config: AppConfig) {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");

  async function getHealth(): Promise<HealthResponse> {
    const response = await fetch(`${baseUrl}/api/v1/health`);

    if (!response.ok) {
      throw new Error(`Health check failed with status ${String(response.status)}`);
    }

    return response.json() as Promise<HealthResponse>;
  }

  return {
    getHealth,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
