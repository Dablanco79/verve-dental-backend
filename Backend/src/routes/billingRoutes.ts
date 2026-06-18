import { Router } from "express";
import { z } from "zod";

import type { AppDependencies } from "../bootstrap/dependencies.js";
import {
  createAuthenticateMiddleware,
  enforceTenantParam,
  requireRoles,
} from "../middleware/authMiddleware.js";
import { createBillingHandlers } from "../controllers/billingController.js";
import {
  validateParams,
  clinicIdParamsSchema,
} from "../middleware/validationMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ── Param schemas ─────────────────────────────────────────────────────────────

const invoiceParamsSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
  invoiceId: z.string().uuid("invoiceId must be a valid UUID"),
});

const lineItemParamsSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
  invoiceId: z.string().uuid("invoiceId must be a valid UUID"),
  lineItemId: z.string().uuid("lineItemId must be a valid UUID"),
});

/**
 * Billing routes — mounted at /clinics/:clinicId/billing
 *
 * RBAC summary:
 *   GET  (read)  → all authenticated roles (tenant-scoped via enforceTenantParam)
 *   POST / PATCH (write) → owner_admin, group_practice_manager only
 *   DELETE       → owner_admin, group_practice_manager only
 *
 * Service-layer `assertTenantAccess` provides defence-in-depth beyond middleware.
 *
 * REST surface:
 *   GET    /invoices                                   list invoices
 *   POST   /invoices                                   create draft invoice
 *   GET    /invoices/:invoiceId                        get invoice detail (+ lines + payments)
 *   PATCH  /invoices/:invoiceId/issue                  issue draft invoice
 *   PATCH  /invoices/:invoiceId/void                   void invoice (requires reason)
 *   GET    /invoices/:invoiceId/line-items             list line items
 *   POST   /invoices/:invoiceId/line-items             add line item
 *   DELETE /invoices/:invoiceId/line-items/:lineItemId remove line item
 *   GET    /invoices/:invoiceId/payments               list payments
 *   POST   /invoices/:invoiceId/payments               record payment
 */
export function createBillingRouter(deps: AppDependencies): Router {
  const router = Router({ mergeParams: true });
  const authenticate = createAuthenticateMiddleware(
    deps.authService,
    deps.auditService,
  );
  const tenantGuard = enforceTenantParam("clinicId");
  const managerOrAdmin = requireRoles("owner_admin", "group_practice_manager");

  const h = createBillingHandlers(deps.billingService);

  // ── Invoice CRUD ──────────────────────────────────────────────────────────

  router.get(
    "/invoices",
    authenticate,
    tenantGuard,
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.listInvoices(req, res)),
  );

  router.post(
    "/invoices",
    authenticate,
    tenantGuard,
    managerOrAdmin,
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.createInvoice(req, res)),
  );

  router.get(
    "/invoices/:invoiceId",
    authenticate,
    tenantGuard,
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.getInvoice(req, res)),
  );

  // ── Invoice lifecycle actions ─────────────────────────────────────────────

  router.patch(
    "/invoices/:invoiceId/issue",
    authenticate,
    tenantGuard,
    managerOrAdmin,
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.issueInvoice(req, res)),
  );

  router.patch(
    "/invoices/:invoiceId/void",
    authenticate,
    tenantGuard,
    managerOrAdmin,
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.voidInvoice(req, res)),
  );

  // ── Line items ────────────────────────────────────────────────────────────

  router.get(
    "/invoices/:invoiceId/line-items",
    authenticate,
    tenantGuard,
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.listLineItems(req, res)),
  );

  router.post(
    "/invoices/:invoiceId/line-items",
    authenticate,
    tenantGuard,
    managerOrAdmin,
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.addLineItem(req, res)),
  );

  router.delete(
    "/invoices/:invoiceId/line-items/:lineItemId",
    authenticate,
    tenantGuard,
    managerOrAdmin,
    validateParams(lineItemParamsSchema),
    asyncHandler((req, res) => h.removeLineItem(req, res)),
  );

  // ── Payments ──────────────────────────────────────────────────────────────

  router.get(
    "/invoices/:invoiceId/payments",
    authenticate,
    tenantGuard,
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.listPayments(req, res)),
  );

  router.post(
    "/invoices/:invoiceId/payments",
    authenticate,
    tenantGuard,
    managerOrAdmin,
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.recordPayment(req, res)),
  );

  return router;
}
