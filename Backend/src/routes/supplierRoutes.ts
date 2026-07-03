/**
 * Supplier routes — Sprint O Procurement Foundations.
 *
 * Mounted at /api/v1/suppliers (global, not clinic-scoped).
 *
 * Auth: all routes require a valid JWT.
 * Write routes (POST, PATCH) require owner_admin or group_practice_manager.
 */

import multer from "multer";
import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createCatalogueImportHandlers } from "../controllers/catalogueImportController.js";
import { createSupplierCatalogueHandlers } from "../controllers/supplierCatalogueController.js";
import { createSupplierHandlers } from "../controllers/supplierController.js";
import {
  createAuthenticateMiddleware,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// 5 MB limit — supplier catalogues should be well within this.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const allowed_ext = [".csv", ".xlsx", ".xls"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    if (allowed.includes(file.mimetype) || allowed_ext.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV, XLSX and XLS files are accepted"));
    }
  },
});

export function createSupplierRouter(deps: AppDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const requireWriteAccess = requireRoles(
    "owner_admin",
    "group_practice_manager",
  );

  const supplierHandlers = createSupplierHandlers(deps.supplierService);
  const catalogueHandlers = createSupplierCatalogueHandlers(
    deps.supplierCatalogueService,
  );
  const importHandlers = createCatalogueImportHandlers(
    deps.catalogueImportService,
  );

  // ── Supplier CRUD ──────────────────────────────────────────────────────────

  router.get(
    "/",
    authenticate,
    asyncHandler((req, res) => supplierHandlers.listSuppliers(req, res)),
  );

  router.post(
    "/",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => supplierHandlers.createSupplier(req, res)),
  );

  router.get(
    "/:supplierId",
    authenticate,
    asyncHandler((req, res) => supplierHandlers.getSupplier(req, res)),
  );

  router.patch(
    "/:supplierId",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) => supplierHandlers.updateSupplier(req, res)),
  );

  // ── Supplier catalogue pricing ─────────────────────────────────────────────
  // Mounted under /:supplierId/catalogue

  router.get(
    "/:supplierId/catalogue",
    authenticate,
    asyncHandler((req, res) =>
      catalogueHandlers.listSupplierProducts(req, res),
    ),
  );

  router.post(
    "/:supplierId/catalogue",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) =>
      catalogueHandlers.createSupplierProduct(req, res),
    ),
  );

  router.get(
    "/:supplierId/catalogue/:supplierProductId",
    authenticate,
    asyncHandler((req, res) =>
      catalogueHandlers.getSupplierProduct(req, res),
    ),
  );

  router.patch(
    "/:supplierId/catalogue/:supplierProductId",
    authenticate,
    requireWriteAccess,
    asyncHandler((req, res) =>
      catalogueHandlers.updateSupplierProduct(req, res),
    ),
  );

  // ── Catalogue import ───────────────────────────────────────────────────────
  // Two-phase: preview (dry-run) → confirm (persist)

  router.post(
    "/:supplierId/catalogue/import/preview",
    authenticate,
    requireWriteAccess,
    upload.single("file"),
    asyncHandler((req, res) => importHandlers.preview(req, res)),
  );

  router.post(
    "/:supplierId/catalogue/import/confirm",
    authenticate,
    requireWriteAccess,
    upload.single("file"),
    asyncHandler((req, res) => importHandlers.confirm(req, res)),
  );

  // ── Product pricing lookup (cross-supplier) ────────────────────────────────
  // GET /products/:productId/pricing — returns all supplier prices for a product

  router.get(
    "/products/:productId/pricing",
    authenticate,
    asyncHandler((req, res) =>
      catalogueHandlers.listPricingForProduct(req, res),
    ),
  );

  return router;
}
