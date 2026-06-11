import type { NextFunction, Request, Response } from "express";

import type { Logger } from "../utils/logger.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export function errorHandler(logger: Logger) {
  return (
    error: unknown,
    _req: Request,
    res: Response<ApiErrorBody>,
    _next: NextFunction,
  ): void => {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";

    logger.error({ err: error }, "Unhandled request error");

    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message,
      },
    });
  };
}
