import "dotenv/config";

import { createApp } from "./app.js";
import { createAppDependencies } from "./bootstrap/dependencies.js";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const deps = await createAppDependencies(config, logger);
  const app = createApp(config, logger, deps);

  const port = config.PORT;
  const host = config.HOST;

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
