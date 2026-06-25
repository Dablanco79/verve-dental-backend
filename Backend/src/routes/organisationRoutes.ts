import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createOrganisationHandlers } from "../controllers/organisationController.js";
import { createOrganisationService } from "../services/organisationService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Organisation routes — Sprint 4A.
 *
 * All routes are restricted to owner_admin via the service layer.
 * The `requireRoles` middleware at the router registration site in index.ts
 * provides a defence-in-depth check before the controller is reached.
 *
 * Routes:
 *   GET    /organisations                 — list all organisations
 *   GET    /organisations/:organisationId — get single organisation
 *   POST   /organisations                 — create organisation
 *   PATCH  /organisations/:organisationId — partial update
 *
 * No DELETE route — organisations are deactivated via status, never removed.
 */
export function createOrganisationRouter(deps: AppDependencies): Router {
  const router = Router();
  const organisationService = createOrganisationService(
    deps.organisationRepository,
  );
  const handlers = createOrganisationHandlers(organisationService);

  router.get(
    "/",
    asyncHandler((req, res) => handlers.listOrganisations(req, res)),
  );

  router.get(
    "/:organisationId",
    asyncHandler((req, res) => handlers.getOrganisation(req, res)),
  );

  router.post(
    "/",
    asyncHandler((req, res) => handlers.createOrganisation(req, res)),
  );

  router.patch(
    "/:organisationId",
    asyncHandler((req, res) => handlers.updateOrganisation(req, res)),
  );

  return router;
}
