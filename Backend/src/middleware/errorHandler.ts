import type { NextFunction, Request, Response } from "express";

import type { EnvConfig } from "../config/index.js";
import { AppError } from "../types/errors.js";
import type { Logger } from "../utils/logger.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export function errorHandler(logger: Logger, config: Pick<EnvConfig, "NODE_ENV">) {
  return (
    error: unknown,
    _req: Request,
    res: Response<ApiErrorBody>,
    // Express requires the 4-argument error middleware signature.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ): void => {
    // req.id is injected by pino-http's genReqId (ReqId = string | number | object).
    // Our genReqId always returns a UUID string, but pino-http's type is broader.
    // Narrow to string to avoid Object stringification; non-string IDs become undefined.
    const rawId = _req.id;
    const requestId = typeof rawId === "string" ? rawId : undefined;

    if (error instanceof AppError) {
      // Operational errors — safe to surface to clients.
      res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      });
      return;
    }

    // Unexpected errors — log full detail, but redact in production.
    logger.error({ err: error, requestId }, "Unhandled request error");

    const message =
      config.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : error instanceof Error
          ? error.message
          : "An unexpected error occurred";

    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message,
        requestId,
      },
    });
  };
}
