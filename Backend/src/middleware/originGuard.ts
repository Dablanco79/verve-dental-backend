/**
 * Origin guard middleware — CSRF/origin protection for cookie-auth endpoints.
 *
 * Motivation
 * ──────────
 * The refresh token is stored in an HttpOnly SameSite=Strict cookie, which
 * prevents most CSRF attacks by default.  This middleware adds an explicit
 * second layer: it checks that the request comes from a known, configured
 * HTTPS origin so that even edge-case browser or embedded-webview requests
 * that bypass SameSite cannot trigger cookie-bearing mutations.
 *
 * Behaviour by environment
 * ────────────────────────
 * Development / Test:
 *   Returns a no-op pass-through — existing test flows (no Origin header)
 *   are unaffected.
 *
 * Staging / Production:
 *   1. Reads the Origin header (sent by browsers on all cross-origin and
 *      same-origin fetch/XHR requests from modern browsers).
 *   2. Falls back to parsing the Referer header when Origin is absent
 *      (some older browser environments only send Referer).
 *   3. Rejects if:
 *        • Neither header is present
 *        • The derived origin is not in the CORS_ORIGIN allow-list
 *        • The origin is not HTTPS (http:// origins are never allowed)
 *   4. Allows only exact matches of configured HTTPS origins.
 *
 * No CSRF token double-submit is required because:
 *   • SameSite=Strict already blocks cross-site cookie delivery.
 *   • Origin checking closes the residual browser-level gap.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { EnvConfig } from "../config/index.js";
import { AppError } from "../types/errors.js";

export function createOriginGuard(
  config: Pick<EnvConfig, "NODE_ENV" | "CORS_ORIGIN">,
): RequestHandler {
  // Development and test: pass-through — preserves existing test flows.
  if (config.NODE_ENV === "development" || config.NODE_ENV === "test") {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  // Build the set of permitted origins from CORS_ORIGIN.
  // Only HTTPS origins are admitted; any http:// or wildcard entries are
  // intentionally excluded even if listed in CORS_ORIGIN.
  const allowedOrigins = new Set(
    config.CORS_ORIGIN
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.startsWith("https://")),
  );

  return (req: Request, _res: Response, next: NextFunction): void => {
    // Primary: Origin header (browsers send this on all XHR/fetch POST requests).
    const originHeader = req.headers["origin"];

    // Fallback: parse Referer to an origin string.
    const refererHeader = req.headers["referer"];

    let requestOrigin: string | undefined;

    if (originHeader) {
      requestOrigin = originHeader;
    } else if (refererHeader) {
      try {
        const url = new URL(refererHeader);
        // url.origin is scheme + host + port — safe for exact comparison.
        requestOrigin = url.origin;
      } catch {
        // Malformed Referer — treat as absent, fall through to rejection.
      }
    }

    if (!requestOrigin) {
      next(
        new AppError(
          403,
          "FORBIDDEN_ORIGIN",
          "Origin or Referer header required",
        ),
      );
      return;
    }

    if (!allowedOrigins.has(requestOrigin)) {
      next(
        new AppError(
          403,
          "FORBIDDEN_ORIGIN",
          "Request origin is not permitted",
        ),
      );
      return;
    }

    next();
  };
}
