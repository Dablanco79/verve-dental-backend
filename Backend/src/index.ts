import "dotenv/config";

import { createApp } from "./app.js";
import { createAppDependencies } from "./bootstrap/dependencies.js";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // Phase 1: Environment validation (fail fast before allocating any resources)
  // ---------------------------------------------------------------------------
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Logger is not yet available — write structured JSON directly to stderr so
    // log aggregators (Datadog, CloudWatch, etc.) can still parse the record.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      JSON.stringify({
        level: "fatal",
        service: "@verve/backend",
        phase: "startup",
        stage: "env-validation",
        msg: message,
        time: new Date().toISOString(),
      }) + "\n",
    );
    process.exit(1);
  }

  const logger = createLogger(config);

  logger.info(
    { env: config.NODE_ENV, port: config.PORT },
    "Environment validated — starting dependency bootstrap",
  );

  // ---------------------------------------------------------------------------
  // Phase 2: Infrastructure bootstrap (DB, Redis, repos, services)
  //
  // Using .catch() keeps deps as a const with the exact inferred type, avoiding
  // the TypeScript control-flow limitation that makes `let deps` resolve to any
  // inside closures when the only exit path is process.exit() in a catch block.
  // ---------------------------------------------------------------------------
  const deps = await createAppDependencies(config, logger).catch(
    (err: unknown) => {
      // createAppDependencies throws for fatal misconfigurations: missing
      // DATABASE_URL / REDIS_URL in production/staging, or an unrecoverable
      // connection error.
      logger.fatal(
        {
          err,
          env: config.NODE_ENV,
          phase: "startup",
          stage: "dependency-bootstrap",
        },
        "Startup failed — required infrastructure is unavailable. " +
          "Check DATABASE_URL, REDIS_URL, and connectivity from this host.",
      );
      process.exit(1);
    },
  );

  // ---------------------------------------------------------------------------
  // Phase 3: HTTP server
  // ---------------------------------------------------------------------------
  const app = createApp(config, logger, deps);

  const { PORT: port, HOST: host } = config;

  const server = app.listen(port, host, () => {
    logger.info(
      { port, host, env: config.NODE_ENV },
      "Verve Backend server started",
    );
  });

  function shutdown(signal: string): void {
    logger.info({ signal }, "Shutting down server");
    server.close(() => {
      void deps.shutdown().finally(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    });
  }

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

void main();
