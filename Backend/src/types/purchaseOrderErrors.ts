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

export class PoCancelledError extends Error {
  readonly code = "PO_CANCELLED" as const;

  constructor() {
    super("Purchase order has been cancelled");
    this.name = "PoCancelledError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PoReceivedError extends Error {
  readonly code = "PO_RECEIVED" as const;

  constructor() {
    super("Purchase order has already been fully received and cannot be modified");
    this.name = "PoReceivedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PoInvalidTransitionError extends Error {
  readonly code = "PO_INVALID_TRANSITION" as const;
  readonly fromStatus: string;
  readonly toStatus: string;

  constructor(fromStatus: string, toStatus: string) {
    super(`Cannot transition purchase order from '${fromStatus}' to '${toStatus}'`);
    this.name = "PoInvalidTransitionError";
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PoNoLinesError extends Error {
  readonly code = "PO_NO_LINES" as const;

  constructor() {
    super("Purchase order must have at least one line before it can be submitted");
    this.name = "PoNoLinesError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PoNoSupplierError extends Error {
  readonly code = "PO_NO_SUPPLIER" as const;

  constructor() {
    super("Purchase order must have a supplier selected before it can be submitted");
    this.name = "PoNoSupplierError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PoLineNotFoundError extends Error {
  readonly code = "PO_LINE_NOT_FOUND" as const;

  constructor(lineId?: string) {
    super(lineId ? `Purchase order line not found: ${lineId}` : "Purchase order line not found");
    this.name = "PoLineNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PoNotEditableError extends Error {
  readonly code = "PO_NOT_EDITABLE" as const;

  constructor(status: string) {
    super(`Purchase order in '${status}' status cannot be edited`);
    this.name = "PoNotEditableError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
