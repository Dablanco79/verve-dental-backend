import type { Request, Response } from "express";

import type { HealthService } from "../services/healthService.js";

/**
 * Liveness probe — answers "is the process alive?".
 * Performs no I/O; always returns 200 as long as the event loop is healthy.
 * Use for container/orchestrator liveness checks (e.g. Kubernetes livenessProbe).
 */
export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: "ok",
    service: "@verve/backend",
    timestamp: new Date().toISOString(),
  });
}

/**
 * Readiness probe — answers "is the process ready to serve traffic?".
 * Probes PostgreSQL (critical) and Redis (non-critical).
 *
 * HTTP status rules:
 *   ready = true  → 200  (all ok, or only non-critical deps degraded)
 *   ready = false → 503  (critical dep down, or every dep unreachable)
 *
 * Use for container/orchestrator readiness checks (e.g. Kubernetes readinessProbe).
 */
export function createReadinessHandler(healthService: HealthService) {
  return async (_req: Request, res: Response): Promise<void> => {
    const result = await healthService.getReadiness();

    // The ready flag encodes the full traffic decision:
    //   true  → 200  (ok or degraded-but-serving)
    //   false → 503  (critical dep down or all deps unavailable)
    const httpStatus = result.ready ? 200 : 503;

    res.status(httpStatus).json(result);
  };
}
