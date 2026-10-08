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
