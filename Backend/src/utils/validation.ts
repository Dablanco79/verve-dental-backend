import { z } from "zod";

import { AppError } from "../types/errors.js";
import type { ValidationDetail } from "../types/errors.js";

/**
 * Maps a ZodError's issues to the structured ValidationDetail array used in
 * VALIDATION_ERROR responses.  Empty path segments (root-level issues) are
 * represented as "_".
 */
export function zodToDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "_",
    message: issue.message,
  }));
}

/**
 * Parse and validate a request body against a Zod schema.
 * Throws AppError(400, VALIDATION_ERROR) with structured field-level details
 * on failure so the global error handler emits the canonical error shape.
 */
export function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Request validation failed",
      zodToDetails(result.error),
    );
  }

  return result.data;
}
