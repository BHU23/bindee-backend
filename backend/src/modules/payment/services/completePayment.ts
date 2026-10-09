import {
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  UnprocessableError,
} from "@/core/errors/index.js";
import type { EventBus, EventName } from "@/core/events/eventBus.js";
import type { Clock } from "@/core/utils/clock.js";
import { transition } from "@/modules/booking/index.js";
import type { PaymentRepository } from "../repositories/paymentRepository.js";
import type {
  PaymentForSettlement,
  PaymentLogger,
  PaymentResult,
  PaymentResultResponse,
  SettlePayment,
} from "../types/payment.js";

export interface CompletePaymentInput {
  paymentId: string;
  result: PaymentResult;
  mockRef: string;
  failureCode?: string;
  /** Only known when the result comes from a card submission. */
  cardLast4?: string;
}

export interface CompletePaymentDeps {
  payments: PaymentRepository;
  eventBus: EventBus;
  clock: Clock;
  holdGraceSeconds: number;
  /** Receives callbacks that contradict an already settled result (AC-PR-08). */
  logger?: PaymentLogger;
}

/** Reads and settles are retried when the booking moves between them (e.g. the hold-expiry job). */
const MAX_ATTEMPTS = 3;

/**
 * The callback path shared by every mock method (AC-MP-07): settles a PENDING payment once and
 * publishes the matching event once. A repeated or late callback finds the payment already
 * settled and changes nothing; if an earlier publish failed, it publishes the owed event.
 */
export function createCompletePayment(deps: CompletePaymentDeps) {
  const { payments, eventBus, clock } = deps;

  /** What settling this payment does to the payment, the booking and the event stream. */
  function planSettlement(
    payment: PaymentForSettlement,
    input: CompletePaymentInput,
  ): SettlePayment {
    const { booking } = payment;
    const base = {
      paymentId: payment.id,
      cardLast4: input.cardLast4 ?? null,
      completedAt: new Date(clock.now()),
    };

    if (input.result === "FAILED") {
      return {
        ...base,
        status: "FAILED",
        failureCode: input.failureCode ?? "MOCK_DECLINED",
        pendingEvent: "PaymentFailed",
        booking:
          booking.status === "PENDING_PAYMENT"
            ? {
                from: booking.status,
                to: transition(booking.status, "PAYMENT_FAILED"),
              }
            : null,
      };
    }

    const graceEndsAt =
      booking.holdExpiresAt.getTime() + deps.holdGraceSeconds * 1000;
    if (booking.status === "PENDING_PAYMENT" && clock.now() <= graceEndsAt) {
      return {
        ...base,
        status: "SUCCESS",
        failureCode: null,
        pendingEvent: "PaymentCompleted",
        booking: {
          from: booking.status,
          to: transition(booking.status, "PAID"),
        },
      };
    }
    // The money is recorded but the booking is left alone. Late success (HS-3) is announced to
    // hold-expired; any other state (e.g. already PAID by another payment) has no owner yet.
    const isLate =
      booking.status === "HOLD_EXPIRED" || booking.status === "PENDING_PAYMENT";
    return {
      ...base,
      status: "SUCCESS",
      failureCode: null,
      pendingEvent: isLate ? "PaidAfterHoldExpired" : null,
      booking: null,
    };
  }

  /** Publishes the settled payment's owed event once; hands it back if the bus fails. */
  async function publishPendingEvent(paymentId: string): Promise<void> {
    const name = await payments.claimPendingEvent(paymentId);
    if (!name) return;
    try {
      const payment = await payments.findForSettlement(paymentId);
      if (!payment) return;
      await eventBus.publish({
        name: name as EventName,
        payload: {
          pnr: payment.booking.pnr,
          bookingId: payment.bookingId,
          paymentId,
          ...(payment.failureCode ? { failureCode: payment.failureCode } : {}),
        },
      });
    } catch (error) {
      await payments.restorePendingEvent(paymentId, name);
      throw error;
    }
  }

  return async function completePayment(
    input: CompletePaymentInput,
  ): Promise<PaymentResultResponse> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const payment = await payments.findForSettlement(input.paymentId);
      if (!payment) {
        throw new NotFoundError("PAYMENT_NOT_FOUND", "Payment not found");
      }
      if (payment.mockRef !== input.mockRef) {
        throw new UnprocessableError(
          "MOCK_REF_MISMATCH",
          "mockRef does not belong to this payment",
        );
      }

      if (payment.status !== "PENDING") {
        // e.g. a late FAILED after SUCCESS: the first result stands (AC-PR-08).
        if (payment.status !== input.result) {
          deps.logger?.warn(
            {
              paymentId: payment.id,
              received: input.result,
              settled: payment.status,
            },
            "ignored callback for an already settled payment",
          );
        }
        await publishPendingEvent(payment.id);
        return resultOf(payment.id, payment.status, payment.failureCode);
      }
      // The booking total is the price to pay (AC-MP-05).
      if (payment.amount !== payment.booking.total) {
        throw new UnprocessableError(
          "AMOUNT_MISMATCH",
          "Payment amount does not match the booking total",
        );
      }

      const plan = planSettlement(payment, input);
      let applied: boolean;
      try {
        applied = await payments.settle(plan);
      } catch (error) {
        // The booking moved after we read it: read again and decide on fresh data.
        if (error instanceof InvalidStateTransitionError) continue;
        throw error;
      }
      // Lost the race to another callback: the next read sees its result.
      if (!applied) continue;
      await publishPendingEvent(payment.id);
      return resultOf(payment.id, plan.status, plan.failureCode);
    }
    throw new ConflictError(
      "PAYMENT_BUSY",
      "The payment keeps changing, please retry",
    );
  };
}

function resultOf(
  paymentId: string,
  status: string,
  failureCode: string | null,
): PaymentResultResponse {
  return {
    paymentId,
    status: status === "SUCCESS" ? "SUCCESS" : "FAILED",
    ...(failureCode ? { failureCode } : {}),
  };
}
