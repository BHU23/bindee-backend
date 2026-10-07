import { InvalidStateTransitionError } from "../../../core/errors/index.js";
import type { BookingStatus } from "../types/bookingStatus.js";

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  DRAFT: ["PENDING_PAYMENT", "SEAT_HOLD_FAILED"],
  PENDING_PAYMENT: ["PAID", "HOLD_EXPIRED", "PAYMENT_FAILED"],
  PAID: ["TICKETED", "TICKETING_FAILED"],
  TICKETED: [],
  SEAT_HOLD_FAILED: [],
  HOLD_EXPIRED: [],
  PAYMENT_FAILED: ["PENDING_PAYMENT"],
  TICKETING_FAILED: ["PAID", "TICKETED"],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Single owner of PNR status transitions: returns the new status or throws INVALID_STATE_TRANSITION. */
export function transition(
  from: BookingStatus,
  to: BookingStatus,
): BookingStatus {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
  return to;
}
