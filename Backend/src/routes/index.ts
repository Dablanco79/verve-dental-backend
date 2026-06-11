import { Router } from "express";

import { getHealth } from "../controllers/healthController.js";

export function createApiRouter(): Router {
  const router = Router();

  router.get("/health", getHealth);

  return router;
}
