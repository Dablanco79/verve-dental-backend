import { z } from "zod";
import type { Request, Response } from "express";

import { AppError } from "../types/errors.js";
import {
  INVOICE_STATUSES,
  LINE_ITEM_TYPES,
  PAYMENT_METHODS,
} from "../types/billing.js";
import type { BillingService } from "../services/billingService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const createInvoiceSchema = z
  .object({
    patientId: z.string().uuid().nullable().optional().default(null),
    patientName: z.string().min(1).max(255),
    dueAt: z.string().datetime({ offset: true }).nullable().optional().default(null),
    taxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
    notes: z.string().max(2000).nullable().optional().default(null),
  })
  .strict();

const addLineItemSchema = z
  .object({
    lineItemType: z.enum(LINE_ITEM_TYPES),
    description: z.string().min(1).max(512),
    catalogueItemId: z.string().uuid().nullable().optional().default(null),
    catalogueSku: z.string().max(64).nullable().optional().default(null),
    quantity: z.number().int().min(1),
    unitPriceCents: z.number().int().min(0),
    taxable: z.boolean().default(true),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();

const recordPaymentSchema = z
  .object({
    paymentMethod: z.enum(PAYMENT_METHODS),
    amountCents: z.number().int().refine((v) => v !== 0, {
      message: "amountCents must be non-zero",
    }),
    referenceNumber: z.string().max(128).nullable().optional().default(null),
    notes: z.string().max(2000).nullable().optional().default(null),
    transactionAt: z.string().datetime({ offset: true }),
  })
  .strict();

const voidInvoiceSchema = z
  .object({
    reason: z.string().min(1).max(1000),
  })
  .strict();

const listInvoicesQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  patientId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper to extract & validate the authenticated user
// ─────────────────────────────────────────────────────────────────────────────

function getCallerOrThrow(req: Request) {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  return req.user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller factory
// ─────────────────────────────────────────────────────────────────────────────

export function createBillingHandlers(billingService: BillingService) {
  return {
    // ── Invoices ─────────────────────────────────────────────────────────────

    async listInvoices(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId } = req.params as { clinicId: string };

      const queryResult = listInvoicesQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          queryResult.error.issues[0]?.message ?? "Invalid query parameters",
        );
      }

      const invoices = await billingService.listInvoices(
        caller,
        clinicId,
        queryResult.data,
      );
      res.status(200).json({ data: invoices });
    },

    async createInvoice(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId } = req.params as { clinicId: string };

      const result = createInvoiceSchema.safeParse(req.body);
      if (!result.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          result.error.issues[0]?.message ?? "Invalid request body",
        );
      }

      const { dueAt, ...rest } = result.data;
      const invoice = await billingService.createDraftInvoice(
        caller,
        clinicId,
        {
          ...rest,
          dueAt: dueAt ? new Date(dueAt) : null,
        },
      );
      res.status(201).json({ data: invoice });
    },

    async getInvoice(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId } = req.params as {
        clinicId: string;
        invoiceId: string;
      };

      const detail = await billingService.getInvoice(
        caller,
        clinicId,
        invoiceId,
      );
      res.status(200).json({ data: detail });
    },

    async issueInvoice(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId } = req.params as {
        clinicId: string;
        invoiceId: string;
      };

      const invoice = await billingService.issueInvoice(
        caller,
        clinicId,
        invoiceId,
      );
      res.status(200).json({ data: invoice });
    },

    async voidInvoice(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId } = req.params as {
        clinicId: string;
        invoiceId: string;
      };

      const result = voidInvoiceSchema.safeParse(req.body);
      if (!result.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          result.error.issues[0]?.message ?? "Invalid request body",
        );
      }

      const invoice = await billingService.voidInvoice(
        caller,
        clinicId,
        invoiceId,
        result.data.reason,
      );
      res.status(200).json({ data: invoice });
    },

    // ── Line items ────────────────────────────────────────────────────────────

    async listLineItems(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId } = req.params as {
        clinicId: string;
        invoiceId: string;
      };

      const lineItems = await billingService.listLineItems(
        caller,
        clinicId,
        invoiceId,
      );
      res.status(200).json({ data: lineItems });
    },

    async addLineItem(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId } = req.params as {
        clinicId: string;
        invoiceId: string;
      };

      const result = addLineItemSchema.safeParse(req.body);
      if (!result.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          result.error.issues[0]?.message ?? "Invalid request body",
        );
      }

      const { lineItem, invoice } = await billingService.addLineItem(
        caller,
        clinicId,
        invoiceId,
        result.data,
      );
      res.status(201).json({ data: { lineItem, invoice } });
    },

    async removeLineItem(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId, lineItemId } = req.params as {
        clinicId: string;
        invoiceId: string;
        lineItemId: string;
      };

      const invoice = await billingService.removeLineItem(
        caller,
        clinicId,
        invoiceId,
        lineItemId,
      );
      res.status(200).json({ data: { invoice } });
    },

    // ── Payments ──────────────────────────────────────────────────────────────

    async listPayments(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId } = req.params as {
        clinicId: string;
        invoiceId: string;
      };

      const payments = await billingService.listPayments(
        caller,
        clinicId,
        invoiceId,
      );
      res.status(200).json({ data: payments });
    },

    async recordPayment(req: Request, res: Response): Promise<void> {
      const caller = getCallerOrThrow(req);
      const { clinicId, invoiceId } = req.params as {
        clinicId: string;
        invoiceId: string;
      };

      const result = recordPaymentSchema.safeParse(req.body);
      if (!result.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          result.error.issues[0]?.message ?? "Invalid request body",
        );
      }

      const { transactionAt, ...rest } = result.data;
      const { payment, invoice } = await billingService.recordPayment(
        caller,
        clinicId,
        invoiceId,
        {
          ...rest,
          transactionAt: new Date(transactionAt),
        },
      );
      res.status(201).json({ data: { payment, invoice } });
    },
  };
}
