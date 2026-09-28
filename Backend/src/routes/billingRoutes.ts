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
 *   ALL routes → owner_admin, group_practice_manager only (security fix: GET routes
 *   previously lacked the role guard; now all routes require managerOrAdmin).
 *   Billing remains admin+GPM only for the pilot — no module:billing gate needed.
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

  // ALL billing routes require: authentication + tenant scope + manager/admin role.
  // Previously, the GET routes lacked the role guard — this is the security fix.
  router.use(authenticate);
  router.use(tenantGuard);
  router.use(managerOrAdmin);

  // ── Invoice CRUD ──────────────────────────────────────────────────────────

  router.get(
    "/invoices",
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.listInvoices(req, res)),
  );

  router.post(
    "/invoices",
    validateParams(clinicIdParamsSchema),
    asyncHandler((req, res) => h.createInvoice(req, res)),
  );

  router.get(
    "/invoices/:invoiceId",
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.getInvoice(req, res)),
  );

  // ── Invoice lifecycle actions ─────────────────────────────────────────────

  router.patch(
    "/invoices/:invoiceId/issue",
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.issueInvoice(req, res)),
  );

  router.patch(
    "/invoices/:invoiceId/void",
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.voidInvoice(req, res)),
  );

  // ── Line items ────────────────────────────────────────────────────────────

  router.get(
    "/invoices/:invoiceId/line-items",
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.listLineItems(req, res)),
  );

  router.post(
    "/invoices/:invoiceId/line-items",
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.addLineItem(req, res)),
  );

  router.delete(
    "/invoices/:invoiceId/line-items/:lineItemId",
    validateParams(lineItemParamsSchema),
    asyncHandler((req, res) => h.removeLineItem(req, res)),
  );

  // ── Payments ──────────────────────────────────────────────────────────────

  router.get(
    "/invoices/:invoiceId/payments",
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.listPayments(req, res)),
  );

  router.post(
    "/invoices/:invoiceId/payments",
    validateParams(invoiceParamsSchema),
    asyncHandler((req, res) => h.recordPayment(req, res)),
  );

  return router;
}
