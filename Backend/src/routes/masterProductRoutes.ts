/**
 * Master product routes — Master Product Management Foundation.
 *
 * Mounted at /api/v1/master-products (global, not clinic-scoped), mirroring
 * the master_catalog_items pattern used by the supplier catalogue import.
 *
 * Auth:
 *   GET routes    — any authenticated role (read-only for clinical_staff).
 *   Write routes  — owner_admin or group_practice_manager only (POST, PATCH,
 *                   archive, reactivate, and the library import).
 */

import multer from "multer";
import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createMasterProductHandlers } from "../controllers/masterProductController.js";
import { createMasterProductImportHandlers } from "../controllers/masterProductImportController.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// 5 MB limit — curated master product libraries should be well within this.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const allowedExt = [".csv", ".xlsx", ".xls"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV, XLSX and XLS files are accepted"));
    }
  },
});

export function createMasterProductRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(deps.authService, deps.auditService);
  const requireWriteAccess = requireRoles("owner_admin", "group_practice_manager");
  const importHandlers = createMasterProductImportHandlers(deps.masterProductImportService);
  const handlers = createMasterProductHandlers(deps.masterProductService);

  // ── Master Products CRUD/list ─────────────────────────────────────────────

  router.get(
    "/",
    authenticate,
    asyncHandler((req, res) => handlers.listMasterProducts(req, res)),
  );

  router.post(
    "/",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.createMasterProduct(req, res)),
  );

  router.get(
    "/:id",
    authenticate,
    asyncHandler((req, res) => handlers.getMasterProduct(req, res)),
  );

  router.patch(
    "/:id",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.updateMasterProduct(req, res)),
  );

  router.post(
    "/:id/archive",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.archiveMasterProduct(req, res)),
  );

  router.post(
    "/:id/reactivate",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => handlers.reactivateMasterProduct(req, res)),
  );

  // ── Master Product Library import ─────────────────────────────────────────

  router.post(
    "/import",
    authenticate,
    requireWriteAccess,
    upload.single("file"),
    asyncHandler((req, res) => importHandlers.importLibrary(req, res)),
  );

  return router;
}
