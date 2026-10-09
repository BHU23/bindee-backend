export const BOOKING_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "PAID",
  "TICKETED",
  "SEAT_HOLD_FAILED",
  "HOLD_EXPIRED",
  "PAYMENT_FAILED",
  "TICKETING_FAILED",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];
