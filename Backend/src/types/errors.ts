/**
 * Structured application error.
 * Throw this anywhere in the request lifecycle to produce a specific HTTP
 * status code and a stable machine-readable `code` string for clients.
 *
 * Example:
 *   throw new AppError(401, "UNAUTHORIZED", "Invalid credentials");
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
