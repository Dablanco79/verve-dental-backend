import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import type { EnvConfig } from "./config/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createApiRouter } from "./routes/index.js";
import type { Logger } from "./utils/logger.js";

export function createApp(config: EnvConfig, logger: Logger) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: config.NODE_ENV !== "test",
    }),
  );

  app.use("/api/v1", createApiRouter());
  app.use(errorHandler(logger));

  return app;
}
