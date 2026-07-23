/**
 * Supplier Invoice Routes — Sprint OCR-1.
 *
 * Mounted at /api/v1/clinics/:clinicId/supplier-invoices
 *
 * Auth:   All routes require a valid JWT (authenticate middleware from parent).
 * Roles:  Write operations (upload, patch, confirm, cancel, void) require
 *         owner_admin or group_practice_manager.
 *         Read operations (list, get) are available to all authenticated users.
 *
 * File upload:  multer memory storage.  Size limit from OCR_MAX_FILE_SIZE_BYTES
 *               config (default 20 MB).  MIME filter: PDF, PNG, JPEG.
 */

import multer from "multer";
import { Router } from "express";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import { createSupplierInvoiceHandlers } from "../controllers/supplierInvoiceController.js";
import { requireRoles } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { EnvConfig } from "../config/index.js";

export function createSupplierInvoiceRouter(
  deps: AppDependencies,
  config: EnvConfig,
): Router {
  const router = Router({ mergeParams: true });

  const requireWriteAccess = requireRoles("owner_admin", "group_practice_manager");

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.OCR_MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      const allowed = [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/jpg",
      ];
      const ext = file.originalname.toLowerCase().split(".").pop() ?? "";
      const allowedExts = ["pdf", "png", "jpg", "jpeg"];

      if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error("Only PDF, PNG, and JPEG files are accepted"));
      }
    },
  });

  const handlers = createSupplierInvoiceHandlers(deps.supplierInvoiceService);

  // ── POST /upload ───────────────────────────────────────────────────────────
  // Upload a supplier invoice file, run OCR, return extracted draft.
  router.post(
    "/upload",
    requireWriteAccess,
    upload.single("file"),
    asyncHandler((req, res) => handlers.upload(req, res)),
  );

  // ── GET / ─────────────────────────────────────────────────────────────────
  // List supplier invoices for a clinic (paginated).
  router.get(
    "/",
    asyncHandler((req, res) => handlers.list(req, res)),
  );

  // ── GET /:invoiceId ────────────────────────────────────────────────────────
  // Get a single invoice with all lines.
  router.get(
    "/:invoiceId",
    asyncHandler((req, res) => handlers.get(req, res)),
  );

  // ── PATCH /:invoiceId ──────────────────────────────────────────────────────
  // Edit invoice header fields during pending_review.
  router.patch(
    "/:invoiceId",
    requireWriteAccess,
    asyncHandler((req, res) => handlers.update(req, res)),
  );

  // ── PATCH /:invoiceId/lines/:lineId ────────────────────────────────────────
  // Edit a line item during pending_review. Totals auto-recalculated.
  router.patch(
    "/:invoiceId/lines/:lineId",
    requireWriteAccess,
    asyncHandler((req, res) => handlers.updateLine(req, res)),
  );

  // ── POST /:invoiceId/confirm ───────────────────────────────────────────────
  // Confirm import: validates required fields, upserts pricing, records history.
  router.post(
    "/:invoiceId/confirm",
    requireWriteAccess,
    asyncHandler((req, res) => handlers.confirm(req, res)),
  );

  // ── POST /:invoiceId/cancel ───────────────────────────────────────────────
  // Cancel a catalogue import review session and remove temporary OCR review data.
  router.post(
    "/:invoiceId/cancel",
    requireWriteAccess,
    asyncHandler((req, res) => handlers.cancel(req, res)),
  );

  // ── POST /:invoiceId/void ──────────────────────────────────────────────────
  // Void a pending_review invoice (terminal state, no undo).
  router.post(
    "/:invoiceId/void",
    requireWriteAccess,
    asyncHandler((req, res) => handlers.void(req, res)),
  );

  // ── POST /:invoiceId/receive ───────────────────────────────────────────────
  // Receive physical stock against a confirmed (imported) invoice.
  // Blocks if the invoice has already been received (409 INVOICE_ALREADY_RECEIVED).
  router.post(
    "/:invoiceId/receive",
    requireWriteAccess,
    asyncHandler((req, res) => handlers.receive(req, res)),
  );

  return router;
}
