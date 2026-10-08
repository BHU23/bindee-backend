export interface ErrorFields {
  [field: string]: string;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: ErrorFields,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", fields?: ErrorFields) {
    super(400, "VALIDATION_ERROR", message, fields);
  }
}

export class NotFoundError extends AppError {
  constructor(code = "NOT_FOUND", message = "Resource not found") {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class InvalidStateTransitionError extends ConflictError {
  constructor(from: string, to: string) {
    super(
      "INVALID_STATE_TRANSITION",
      `Cannot change booking status from ${from} to ${to}`,
    );
  }
}

export class SeatUnavailableError extends ConflictError {
  constructor(message = "One or more requested seats are no longer available") {
    super("SEAT_UNAVAILABLE", message);
  }
}

export class SearchExpiredError extends AppError {
  constructor(
    message = "Search results have expired, please search again",
    /** Criteria of the expired search, so the client can offer to search again. */
    readonly query?: object,
  ) {
    super(410, "SEARCH_EXPIRED", message);
  }
}

export class InventoryUnavailableError extends AppError {
  constructor(
    message = "Inventory is temporarily unavailable",
    cause?: unknown,
  ) {
    super(503, "INVENTORY_UNAVAILABLE", message);
    this.cause = cause;
  }
}
