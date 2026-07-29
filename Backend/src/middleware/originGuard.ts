/**
 * Origin guard middleware — CSRF/origin protection for cookie-auth endpoints.
 *
 * Motivation
 * ──────────
 * In production the refresh-token cookie uses SameSite=None so that the
 * browser includes it on cross-site POST /auth/refresh requests (the
 * frontend and backend are deployed on different *.onrender.com subdomains,
 * which the Public Suffix List classifies as distinct sites).
 *
 * SameSite=None means the browser will send the cookie on ANY cross-site
 * request, including forged ones.  This middleware is therefore the PRIMARY
 * CSRF protection layer in staging and production: it validates the Origin
 * header (or Referer fallback) against the configured CORS_ORIGIN allow-list
 * before any cookie-authenticated handler runs.
 *
 * In development the Vite proxy makes every request same-origin, so
 * SameSite=Strict is used there and no Origin check is required.
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
 * No CSRF token double-submit is required because Origin checking combined
 * with HttpOnly prevents both forged requests and token exfiltration.
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
