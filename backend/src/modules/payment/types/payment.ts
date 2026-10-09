import type { EventName } from "@/core/events/eventBus.js";
import type { BookingStatus } from "@/modules/booking/index.js";

export interface NewPayment {
  bookingId: string;
  idempotencyKey: string;
  method: string;
  amount: number;
  currency: "THB";
  expiresAt: Date;
  mockRef: string;
  createdAt: Date;
}

export interface PaymentRecord {
  id: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  expiresAt: Date;
  mockRef: string;
}

export interface PaymentMethodResponse {
  method: string;
  next: string;
}

export interface StartPaymentResponse {
  paymentId: string;
  status: "PENDING";
  amount: number;
  currency: string;
  expiresAt: string;
  mockRef: string;
}

/** A payment with the booking facts needed to settle it. */
export interface PaymentForSettlement {
  id: string;
  bookingId: string;
  method: string;
  status: string;
  amount: number;
  mockRef: string;
  failureCode: string | null;
  pendingEvent: string | null;
  booking: {
    pnr: string;
    sessionId: string;
    status: BookingStatus;
    total: number;
    holdExpiresAt: Date;
  };
}

export interface SettlePayment {
  paymentId: string;
  status: "SUCCESS" | "FAILED";
  failureCode: string | null;
  cardLast4: string | null;
  completedAt: Date;
  /** Event the settlement owes the rest of the system; published after the commit. */
  pendingEvent: EventName | null;
  /** Booking status change made in the same transaction, when the payment moves the booking. */
  booking: { from: BookingStatus; to: BookingStatus } | null;
}

export type PaymentResult = "SUCCESS" | "FAILED";

export interface PaymentResultResponse {
  paymentId: string;
  status: PaymentResult;
  failureCode?: string;
}
