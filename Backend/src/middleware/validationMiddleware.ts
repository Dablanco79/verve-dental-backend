/**
 * validationMiddleware.ts
 *
 * Reusable Express middleware factories for validating incoming request data
 * against Zod schemas.  Each factory returns a `RequestHandler` that:
 *
 *   1. Runs `schema.safeParse()` on the relevant request property.
 *   2. On failure — calls `next(AppError(400, VALIDATION_ERROR, ...))` with
 *      structured field-level details so the global error handler emits the
 *      canonical validation error shape:
 *
 *        {
 *          "error": {
 *            "code": "VALIDATION_ERROR",
 *            "message": "Request validation failed",
 *            "details": [{ "field": "forecastDays", "message": "..." }]
 *          }
 *        }
 *
 *   3. On success — stores the parsed (and possibly transformed) value in
 *      `res.locals` under a well-known key and calls `next()`.
 *
 * Parsed values are available to downstream handlers via:
 *   res.locals.validatedBody    (set by validateBody)
 *   res.locals.validatedQuery   (set by validateQuery)
 *   res.locals.validatedParams  (set by validateParams)
 *
 * Usage example (route file):
 *
 *   import { validateBody, validateParams } from "../middleware/validationMiddleware.js";
 *   import { z } from "zod";
 *
 *   const invoiceParamsSchema = z.object({
 *     clinicId:  z.string().uuid("clinicId must be a valid UUID"),
 *     invoiceId: z.string().uuid("invoiceId must be a valid UUID"),
 *   });
 *
 *   router.post(
 *     "/:invoiceId/line-items",
 *     authenticate,
 *     validateParams(invoiceParamsSchema),
 *     asyncHandler((req, res) => handlers.addLineItem(req, res)),
 *   );
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import { AppError } from "../types/errors.js";
import { zodToDetails } from "../utils/validation.js";

// ── Internal helper ────────────────────────────────────────────────────────────

function makeValidationError(error: z.ZodError): AppError {
  return new AppError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed",
    zodToDetails(error),
  );
}

// ── Middleware factories ────────────────────────────────────────────────────────

/**
 * Validates `req.body` against `schema`.
 * Parsed data is stored in `res.locals.validatedBody` on success.
 */
export function validateBody<T>(schema: z.ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(makeValidationError(result.error));
      return;
    }
    res.locals["validatedBody"] = result.data;
    next();
  };
}

/**
 * Validates `req.query` against `schema`.
 * Parsed data is stored in `res.locals.validatedQuery` on success.
 *
 * Note: Express types `req.query` values as `string | string[] | ParsedQs |
 * ParsedQs[]`.  Schemas should account for this (e.g. use `.transform()` to
 * coerce strings to numbers, as the existing forecastQuerySchema already does).
 */
export function validateQuery<T>(schema: z.ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(makeValidationError(result.error));
      return;
    }
    res.locals["validatedQuery"] = result.data;
    next();
  };
}

/**
 * Validates `req.params` against `schema`.
 * Parsed data is stored in `res.locals.validatedParams` on success.
 *
 * Apply at the route level (after authenticate/tenantGuard) to reject
 * non-UUID path parameters before they reach repository queries.
 */
export function validateParams<T>(schema: z.ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(makeValidationError(result.error));
      return;
    }
    res.locals["validatedParams"] = result.data;
    next();
  };
}

// ── Common reusable param schemas ─────────────────────────────────────────────

/**
 * Validates the :clinicId path segment present on all /clinics/:clinicId/* routes.
 * Use with validateParams to reject non-UUID clinic identifiers before they reach
 * repository queries.
 */
export const clinicIdParamsSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
});

/**
 * Validates :clinicId + :userId (e.g. POST /clinics/:clinicId/users/:userId/reset-password).
 */
export const clinicUserParamsSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
  userId: z.string().uuid("userId must be a valid UUID"),
});

/**
 * Validates :clinicId + :itemId (e.g. GET /clinics/:clinicId/inventory/:itemId).
 */
export const clinicInventoryItemParamsSchema = z.object({
  clinicId: z.string().uuid("clinicId must be a valid UUID"),
  itemId: z.string().uuid("itemId must be a valid UUID"),
});

/**
 * Validates :clinicId + :userId + :permission (e.g. DELETE /clinics/:clinicId/users/:userId/permissions/:permission).
 * The permission segment is a free-form string (e.g. "inventory:read").
 */
export const clinicUserPermissionParamsSchema = z.object({
  clinicId:   z.string().uuid("clinicId must be a valid UUID"),
  userId:     z.string().uuid("userId must be a valid UUID"),
  permission: z.string().min(1, "permission must not be empty"),
});
