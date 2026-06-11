import "dotenv/config";

import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./utils/logger.js";

const config = loadConfig();
const logger = createLogger(config);
const app = createApp(config, logger);

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    "Verve Backend server started",
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down server");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
