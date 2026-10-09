import type { BookingStatus } from "./bookingStatus.js";

export interface NewBooking {
  pnr: string;
  draftId: string;
  sessionId: string;
  status: BookingStatus;
  total: number;
  holdId: string;
  holdExpiresAt: Date;
  createdAt: Date;
}

/** Outcome of inserting a booking: a unique violation says which rule was hit. */
export type CreateBookingResult =
  { kind: "created" } | { kind: "pnr_taken" } | { kind: "draft_taken" };

export interface ConfirmBookingResponse {
  pnr: string;
  status: "PENDING_PAYMENT";
  holdExpiresAt: string;
  total: number;
}

/** `GET /bookings/:pnr`: the booking read model; `paymentReference` is set once a payment succeeded (AC-MP-10). */
export interface BookingResponse {
  pnr: string;
  status: BookingStatus;
  total: number;
  holdExpiresAt: string;
  paymentReference?: string;
}

export interface BookingDetail extends BookingForPayment {
  paymentReference: string | null;
}

/** What the payment module needs to know about a booking. */
export interface BookingForPayment {
  id: string;
  pnr: string;
  status: BookingStatus;
  total: number;
  holdExpiresAt: Date;
}
