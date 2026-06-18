/**
 * A single field-level validation failure surfaced in the `details` array of a
 * 400 VALIDATION_ERROR response.
 */
export interface ValidationDetail {
  /** Dot-separated field path (e.g. "email", "address.postcode"). "_" for root. */
  field: string;
  message: string;
}

/**
 * Structured application error.
 * Throw this anywhere in the request lifecycle to produce a specific HTTP
 * status code and a stable machine-readable `code` string for clients.
 *
 * Example:
 *   throw new AppError(401, "UNAUTHORIZED", "Invalid credentials");
 *   throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", [
 *     { field: "email", message: "Invalid email address" },
 *   ]);
 *
 * Supported codes (non-exhaustive):
 *   VALIDATION_ERROR  — malformed or out-of-range request input (400)
 *   NOT_FOUND         — resource does not exist (404)
 *   CONFLICT          — state conflict (e.g. duplicate, already-submitted) (409)
 *   UNAUTHORIZED      — missing or invalid authentication (401)
 *   FORBIDDEN         — authenticated but not permitted (403)
 *   INTERNAL_ERROR    — unexpected server-side failure (500)
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: readonly ValidationDetail[],
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
