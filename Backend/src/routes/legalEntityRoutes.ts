import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createLegalEntityHandlers } from "../controllers/legalEntityController.js";
import { createLegalEntityService } from "../services/legalEntityService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Organisation-scoped router — mounted at /organisations/:organisationId/legal-entities.
 *
 * Routes:
 *   GET  /   → listByOrganisation
 *   POST /   → createLegalEntity
 */
export function createLegalEntityOrganisationRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const legalEntityService = createLegalEntityService(deps.legalEntityRepository);
  const handlers = createLegalEntityHandlers(legalEntityService);

  router.get(
    "/",
    asyncHandler((req, res) => handlers.listByOrganisation(req, res)),
  );

  router.post(
    "/",
    asyncHandler((req, res) => handlers.createLegalEntity(req, res)),
  );

  return router;
}

/**
 * Standalone router — mounted at /legal-entities.
 *
 * Routes:
 *   GET   /:id → getLegalEntity
 *   PATCH /:id → updateLegalEntity
 */
export function createLegalEntityRouter(deps: AppDependencies): Router {
  const router = Router();
  const legalEntityService = createLegalEntityService(deps.legalEntityRepository);
  const handlers = createLegalEntityHandlers(legalEntityService);

  router.get(
    "/:id",
    asyncHandler((req, res) => handlers.getLegalEntity(req, res)),
  );

  router.patch(
    "/:id",
    asyncHandler((req, res) => handlers.updateLegalEntity(req, res)),
  );

  return router;
}
