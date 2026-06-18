import { randomUUID } from "node:crypto";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type { Request } from "express";
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
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      autoLogging: config.NODE_ENV !== "test",
      // Propagate or generate a deterministic request ID for distributed tracing.
      // Incoming x-request-id (from a gateway/load-balancer) is honoured; a new
      // UUID v4 is generated for requests that arrive without one.
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id =
          (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      // Enrich every log line with structured operational context.
      // customProps runs at response time, after auth middleware has populated
      // req.user and Express has matched the route — so all fields are available.
      customProps: (req) => {
        const r = req as unknown as Request;
        const props: Record<string, unknown> = {
          // pino-http sets req.id via genReqId above; cast needed because
          // IncomingMessage doesn't carry id in its vanilla TS types.
          requestId: (req as { id?: string }).id,
        };
        if (r.user?.id !== undefined) {
          props["userId"] = r.user.id;
        }
        if (r.params["clinicId"] !== undefined) {
          props["tenantId"] = r.params["clinicId"];
        }
        // req.route is populated by Express after the route handler is matched.
        const routePath = (r.route as { path?: string } | undefined)?.path;
        if (routePath !== undefined) {
          props["route"] = routePath;
        }
        return props;
      },
    }),
  );

  app.use("/api/v1", createApiRouter(deps, config));
  app.use(errorHandler(logger, config));

  return app;
}
