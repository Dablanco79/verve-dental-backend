/**
 * Supplier Invoice Controller — Sprint OCR-1.
 *
 * Handles HTTP request/response for all supplier invoice endpoints.
 * Input validation uses zod.  All monetary and confidence values are validated
 * before reaching the service layer.
 *
 * Route parameter `clinicId` comes from the URL; the service enforces tenant
 * access independently via assertTenantAccess().
 */

import { z } from "zod";
import type { Request, Response } from "express";
import type { SupplierInvoiceService } from "../services/supplierInvoiceService.js";
import { AppError } from "../types/errors.js";
import type { AuthenticatedUser } from "../types/auth.js";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const updateInvoiceSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  supplierNameRaw: z.string().max(512).nullable().optional(),
  invoiceNumber: z.string().max(128).nullable().optional(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "invoiceDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updateLineSchema = z.object({
  ocrDescription: z.string().max(512).optional(),
  ocrSku: z.string().max(128).nullable().optional(),
  quantity: z.number().positive().optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  taxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
  masterCatalogItemId: z.string().uuid().nullable().optional(),
  supplierCatalogueId: z.string().uuid().nullable().optional(),
  isMatched: z.boolean().optional(),
  matchMethod: z
    .enum(["exact_sku", "name_match", "manual"])
    .nullable()
    .optional(),
});

const listQuerySchema = z.object({
  status: z.enum(["pending_review", "confirmed", "voided"]).optional(),
  supplierId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCaller(req: Request): AuthenticatedUser {
  const caller = req.user;
  if (!caller) throw new AppError(401, "UNAUTHORISED", "Authentication required");
  return caller;
}

function getClinicId(req: Request): string {
  const raw = req.params.clinicId;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid clinicId");
  }
  return parsed.data;
}

// ── Controller factory ────────────────────────────────────────────────────────

export function createSupplierInvoiceHandlers(
  service: SupplierInvoiceService,
) {
  return {
    // ── POST /upload ─────────────────────────────────────────────────────────

    async upload(req: Request, res: Response): Promise<void> {
      const caller = getCaller(req);
      const clinicId = getClinicId(req);

      if (!req.file) {
        throw new AppError(400, "VALIDATION_ERROR", "No file uploaded. Send a PDF, PNG, or JPEG.");
      }

      const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
      if (!allowed.includes(req.file.mimetype)) {
        throw new AppError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          `Unsupported file type: ${req.file.mimetype}. Accepted: PDF, PNG, JPEG.`,
        );
      }

      const result = await service.uploadAndExtract(caller, clinicId, {
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      });

      res.status(201).json({ data: result });
    },

    // ── GET / ────────────────────────────────────────────────────────────────

    async list(req: Request, res: Response): Promise<void> {
      const caller = getCaller(req);
      const clinicId = getClinicId(req);

      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid query parameters");
      }

      const { page, limit, ...filters } = parsed.data;
      const offset = (page - 1) * limit;

      const invoices = await service.listInvoices(caller, clinicId, {
        ...filters,
        limit,
        offset,
      });

      res.status(200).json({ data: invoices });
    },

    // ── GET /:invoiceId ───────────────────────────────────────────────────────

    async get(req: Request, res: Response): Promise<void> {
      const caller = getCaller(req);
      const clinicId = getClinicId(req);

      const invoiceId = uuidSchema.safeParse(req.params.invoiceId);
      if (!invoiceId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid invoiceId");
      }

      const result = await service.getInvoice(caller, clinicId, invoiceId.data);
      res.status(200).json({ data: result });
    },

    // ── PATCH /:invoiceId ─────────────────────────────────────────────────────

    async update(req: Request, res: Response): Promise<void> {
      const caller = getCaller(req);
      const clinicId = getClinicId(req);

      const invoiceId = uuidSchema.safeParse(req.params.invoiceId);
      if (!invoiceId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid invoiceId");
      }

      const body = updateInvoiceSchema.safeParse(req.body);
      if (!body.success) {
        throw new AppError(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Invalid request body");
      }

      const result = await service.updateInvoice(
        caller,
        clinicId,
        invoiceId.data,
        body.data,
      );

      res.status(200).json({ data: result });
    },

    // ── PATCH /:invoiceId/lines/:lineId ────────────────────────────────────

    async updateLine(req: Request, res: Response): Promise<void> {
      const caller = getCaller(req);
      const clinicId = getClinicId(req);

      const invoiceId = uuidSchema.safeParse(req.params.invoiceId);
      if (!invoiceId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid invoiceId");
      }

      const lineId = uuidSchema.safeParse(req.params.lineId);
      if (!lineId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid lineId");
      }

      const body = updateLineSchema.safeParse(req.body);
      if (!body.success) {
        throw new AppError(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Invalid request body");
      }

      const line = await service.updateLine(
        caller,
        clinicId,
        invoiceId.data,
        lineId.data,
        body.data,
      );

      res.status(200).json({ data: line });
    },

    // ── POST /:invoiceId/confirm ──────────────────────────────────────────────

    async confirm(req: Request, res: Response): Promise<void> {
      const caller = getCaller(req);
      const clinicId = getClinicId(req);

      const invoiceId = uuidSchema.safeParse(req.params.invoiceId);
      if (!invoiceId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid invoiceId");
      }

      const result = await service.confirmImport(caller, clinicId, invoiceId.data);
      res.status(200).json({ data: result });
    },

    // ── POST /:invoiceId/void ─────────────────────────────────────────────────

    async void(req: Request, res: Response): Promise<void> {
      const caller = getCaller(req);
      const clinicId = getClinicId(req);

      const invoiceId = uuidSchema.safeParse(req.params.invoiceId);
      if (!invoiceId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid invoiceId");
      }

      const invoice = await service.voidInvoice(caller, clinicId, invoiceId.data);
      res.status(200).json({ data: invoice });
    },
  };
}
