export interface ErrorFields {
  [field: string]: string;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: ErrorFields,
    /** Extra members merged into the response `error` object. */
    readonly details?: object,
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

/** A 400 that carries its own machine-readable code (unlike the generic VALIDATION_ERROR). */
export class BadRequestError extends AppError {
  constructor(code: string, message: string, fields?: ErrorFields) {
    super(400, code, message, fields);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid credentials") {
    super(401, "UNAUTHORIZED", message);
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

export class UnprocessableError extends AppError {
  constructor(code: string, message: string, fields?: ErrorFields) {
    super(422, code, message, fields);
  }
}

export class PriceChangedError extends AppError {
  constructor(
    price: {
      oldPrice: number;
      newPrice: number;
      reason: "PRICE_UPDATED" | "FARE_SOLD_OUT";
    },
    extra: object = {},
  ) {
    super(409, "PRICE_CHANGED", "The fare price has changed", undefined, {
      ...price,
      diff: price.newPrice - price.oldPrice,
      ...extra,
    });
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

export class HoldExpiredError extends AppError {
  constructor(message = "The seat hold for this booking has expired") {
    super(410, "HOLD_EXPIRED", message);
  }
}
