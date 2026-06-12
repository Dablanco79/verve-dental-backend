import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import type { AppDependencies } from "./bootstrap/dependencies.js";
import type { EnvConfig } from "./config/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createApiRouter } from "./routes/index.js";
import { createCorsOriginHandler } from "./utils/cors.js";
import type { Logger } from "./utils/logger.js";

export function createApp(
  config: EnvConfig,
  logger: Logger,
  deps: AppDependencies,
) {
  const app = express();

  // Render (and most PaaS load balancers) sit one hop in front; trust that hop
  // so req.ip resolves to the real client IP rather than the internal proxy IP.
  app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: createCorsOriginHandler(config.CORS_ORIGIN),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: config.NODE_ENV !== "test",
    }),
  );

  app.use("/api/v1", createApiRouter(deps, config));
  app.use(errorHandler(logger, config));

  return app;
}
