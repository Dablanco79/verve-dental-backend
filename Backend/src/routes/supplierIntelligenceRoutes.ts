/**
 * Supplier Intelligence Routes — Sprint 3.
 *
 * Mounted at /api/v1/clinics/:clinicId/supplier-intelligence
 *
 * Auth:  Requires authenticated user (authenticate middleware from parent router).
 * RBAC:  Read-only — available to all authenticated roles (mirrors supplier invoice GET).
 *        Only owner_admin and group_practice_manager see the nav link in the UI,
 *        but the endpoint itself is accessible to all authenticated users in scope.
 *
 * The service falls back gracefully when data is missing (returns empty arrays,
 * null saving fields, and appropriate confidence/reason explanations).
 */

import { Router } from "express";
import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createSupplierIntelligenceHandlers } from "../controllers/supplierIntelligenceController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createSupplierIntelligenceRouter(
  deps: AppDependencies,
): Router {
  const router = Router({ mergeParams: true });

  const handlers = createSupplierIntelligenceHandlers(
    deps.supplierIntelligenceService,
  );

  // GET /  — returns intelligence report for the clinic
  router.get(
    "/",
    asyncHandler((req, res) => handlers.get(req, res)),
  );

  return router;
}
