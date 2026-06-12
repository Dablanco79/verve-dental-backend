import { z } from "zod";

import { AppError } from "../types/errors.js";

export function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join("; ");
    throw new AppError(400, "VALIDATION_ERROR", message);
  }

  return result.data;
}
