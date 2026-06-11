import pino from "pino";

import type { EnvConfig } from "../config/index.js";

export function createLogger(config: Pick<EnvConfig, "LOG_LEVEL">) {
  return pino({
    level: config.LOG_LEVEL,
    base: {
      service: "@verve/backend",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
