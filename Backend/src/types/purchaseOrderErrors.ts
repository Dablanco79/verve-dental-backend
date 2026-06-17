/**
 * Typed domain errors for the purchase order workflow.
 *
 * Using typed errors (rather than plain Errors with string messages) means
 * the service layer can distinguish domain states with an `instanceof` check
 * rather than string matching — making error handling race-safe and resilient
 * to message wording changes.
 *
 * These errors are thrown by the repository and caught by the service, which
 * maps them to the appropriate AppError HTTP status code.
 */

export class PoNotFoundError extends Error {
  readonly code = "PO_NOT_FOUND" as const;

  constructor(poId?: string) {
    super(poId ? `Purchase order not found: ${poId}` : "Purchase order not found");
    this.name = "PoNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PoAlreadySubmittedError extends Error {
  readonly code = "PO_ALREADY_SUBMITTED" as const;

  constructor() {
    super("Purchase order has already been submitted");
    this.name = "PoAlreadySubmittedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
