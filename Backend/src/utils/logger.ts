import pino from "pino";
import type { DestinationStream } from "pino";

import type { EnvConfig } from "../config/index.js";

const SENSITIVE_HEADER_PATHS = [
  // Actual pino-http request/response serializer shapes.
  "req.headers",
  "req.raw.headers",
  "res.headers",
  "res.raw.headers",
  // Defensive coverage for explicitly logged or nested HTTP structures.
  "headers",
  "request.headers",
  "response.headers",
  "*.headers",
  "*.*.headers",
  "*.*.*.headers",
  "*.request.headers",
  "*.response.headers",
] as const;

export function createLogger(
  config: Pick<EnvConfig, "LOG_LEVEL">,
  destination?: DestinationStream,
) {
  const options: pino.LoggerOptions = {
    level: config.LOG_LEVEL,
    base: {
      service: "@verve/backend",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Remove complete HTTP header containers. This prevents Authorization,
    // Cookie, Proxy-Authorization, Set-Cookie, API-key and authentication-token
    // variants from leaking, including future/custom header names.
    redact: {
      paths: [...SENSITIVE_HEADER_PATHS],
      remove: true,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export type Logger = ReturnType<typeof createLogger>;
