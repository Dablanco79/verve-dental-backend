/**
 * Supplier Intelligence Routes — Sprint 3.
 *
 * Mounted at /api/v1/clinics/:clinicId/supplier-intelligence
 *
 * Auth:  Requires authenticated user (authenticate middleware from parent router).
 * RBAC:  Read-only and protected by module:procurement. Role-specific navigation
 *        remains a UI concern; the backend module gate is authoritative.
 *
 * The service falls back gracefully when data is missing (returns empty arrays,
 * null saving fields, and appropriate confidence/reason explanations).
 */

import { Router } from "express";
import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createSupplierIntelligenceHandlers } from "../controllers/supplierIntelligenceController.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { PERMISSIONS } from "../types/permissions.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createSupplierIntelligenceRouter(
  deps: AppDependencies,
): Router {
  const router = Router({ mergeParams: true });

  const handlers = createSupplierIntelligenceHandlers(
    deps.supplierIntelligenceService,
  );

  router.use(requirePermission(PERMISSIONS.MODULE_PROCUREMENT));

  // GET /  — returns intelligence report for the clinic
  router.get(
    "/",
    asyncHandler((req, res) => handlers.get(req, res)),
  );

  return router;
}
