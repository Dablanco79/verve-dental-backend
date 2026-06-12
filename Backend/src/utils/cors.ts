import type { CorsOptions } from "cors";

/**
 * Builds a CORS origin handler from `CORS_ORIGIN`.
 * Supports comma-separated origins and `*` (allow any origin; required when credentials are enabled).
 */
export function createCorsOriginHandler(
  corsOrigin: string,
): CorsOptions["origin"] {
  const allowedOrigins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.includes("*")) {
    return (_origin, callback) => {
      callback(null, true);
    };
  }

  return (requestOrigin, callback) => {
    if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
  };
}
