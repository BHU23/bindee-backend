import { randomInt as cryptoRandomInt } from "node:crypto";
import {
  ConflictError,
  UnprocessableError,
  HoldExpiredError,
  NotFoundError,
  ValidationError,
} from "@/core/errors/index.js";
import type { EventBus } from "@/core/events/eventBus.js";
import type { Clock } from "@/core/utils/clock.js";
import { hashRequest, type WithIdempotency } from "@/core/utils/idempotency.js";
import { validate } from "@/core/utils/validate.js";
import type { PrismaClient } from "@/database/generated/client.js";
import {
  createBookingRepository,
  type BookingForPayment,
} from "@/modules/booking/index.js";
import { generateMockRef } from "../models/mockRef.js";
import { lastFour, outcomeForCard } from "../models/testCards.js";
import { createPaymentRepository } from "../repositories/paymentRepository.js";
import type {
  PaymentMethodResponse,
  PaymentRecord,
  PaymentResultResponse,
  StartPaymentResponse,
} from "../types/payment.js";
import { createCompletePayment } from "./completePayment.js";
import {
  callbackSchema,
  cardSchema,
  paymentIdParamsSchema,
} from "../validators/card.js";
import {
  idempotencyKeySchema,
  paymentMethodSchema,
  pnrParamsSchema,
} from "../validators/payment.js";
import { paymentMethodView, startPaymentView } from "../views/paymentView.js";

const IDEMPOTENCY_SCOPE = "start-payment";
const PAYABLE_STATUS = "PENDING_PAYMENT";
const DEFAULT_HOLD_GRACE_SECONDS = 60;
const MOCK_REF_ATTEMPTS = 5;

export interface PaymentService {
  /** Saves the chosen method on a PENDING_PAYMENT booking (idempotent PUT). */
  saveMethod(
    params: unknown,
    body: unknown,
    sessionId?: string,
  ): Promise<PaymentMethodResponse>;
  /** Starts a mock payment for the booking; the same Idempotency-Key returns the same payment. */
  startPayment(
    params: unknown,
    idempotencyKey: unknown,
    body: unknown,
    sessionId?: string,
  ): Promise<StartPaymentResponse>;
  /** Submits a test card for a PENDING card payment and settles it with the simulated outcome. */
  payByCard(
    params: unknown,
    body: unknown,
    sessionId?: string,
  ): Promise<PaymentResultResponse>;
  /** Internal webhook of the mock payment service: settles a PENDING payment once. */
  handleCallback(body: unknown): Promise<PaymentResultResponse>;
}

export interface PaymentServiceDeps {
  prisma: PrismaClient;
  clock: Clock;
  eventBus: EventBus;
  withIdempotency: WithIdempotency;
  /** Random source for the mock reference; defaults to crypto.randomInt. */
  randomInt?: (max: number) => number;
  /** Seconds after the hold expires during which a started payment still completes normally; default 60. */
  holdGraceSeconds?: number;
}

function requireSession(sessionId: string | undefined): string {
  if (sessionId === undefined) {
    throw new ValidationError("X-Session-Id header is required");
  }
  return sessionId;
}

export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  const { clock, eventBus, withIdempotency } = deps;
  const randomInt = deps.randomInt ?? cryptoRandomInt;
  const bookings = createBookingRepository(deps.prisma);
  const payments = createPaymentRepository(deps.prisma);
  const holdGraceSeconds = deps.holdGraceSeconds ?? DEFAULT_HOLD_GRACE_SECONDS;
  const completePayment = createCompletePayment({
    payments,
    eventBus,
    clock,
    holdGraceSeconds,
  });

  /** The session's booking, which must still be payable: PENDING_PAYMENT (409) with a live hold (410). */
  async function loadPayable(
    pnr: string,
    sessionId: string,
  ): Promise<BookingForPayment> {
    const booking = await bookings.findForSession(pnr, sessionId);
    if (!booking) {
      throw new NotFoundError("BOOKING_NOT_FOUND", "Booking not found");
    }
    if (booking.status !== PAYABLE_STATUS) {
      throw new ConflictError(
        "INVALID_STATE_TRANSITION",
        `Booking is ${booking.status}; payment is only possible while ${PAYABLE_STATUS}`,
      );
    }
    if (clock.now() >= booking.holdExpiresAt.getTime()) {
      throw new HoldExpiredError();
    }
    return booking;
  }

  async function createPayment(
    booking: BookingForPayment,
    idempotencyKey: string,
    method: string,
  ) {
    const existing = await payments.findByKey(booking.id, idempotencyKey);
    if (existing) return existing;
    const now = new Date(clock.now());
    // The 6-character suffix is unique per day only by chance: draw again on a mockRef collision.
    for (let attempt = 1; attempt <= MOCK_REF_ATTEMPTS; attempt++) {
      const created = await payments.create({
        bookingId: booking.id,
        idempotencyKey,
        method,
        amount: booking.total,
        currency: "THB",
        // The payment window is the rest of the hold: expiresAt <= holdExpiresAt (AC-MP-01).
        expiresAt: booking.holdExpiresAt,
        mockRef: generateMockRef(now, randomInt),
        createdAt: now,
      });
      if (created) return announce(booking, created);
      // The key may have been taken by a concurrent request with the same Idempotency-Key.
      const sameKey = await payments.findByKey(booking.id, idempotencyKey);
      if (sameKey) return sameKey;
    }
    throw new ConflictError(
      "MOCK_REF_UNAVAILABLE",
      "Could not allocate a mock reference, please retry",
    );
  }

  async function announce(booking: BookingForPayment, created: PaymentRecord) {
    await eventBus.publish({
      name: "PaymentPending",
      payload: { pnr: booking.pnr, paymentId: created.id },
    });
    return created;
  }

  return {
    async saveMethod(params, body, sessionId) {
      const session = requireSession(sessionId);
      const { pnr } = validate(pnrParamsSchema, params);
      const { method } = validate(paymentMethodSchema, body);
      const booking = await loadPayable(pnr, session);
      await payments.saveSelection(booking.id, method, new Date(clock.now()));
      await eventBus.publish({
        name: "PaymentMethodSelected",
        payload: { pnr, method },
      });
      return paymentMethodView(method);
    },

    async startPayment(params, idempotencyKey, body, sessionId) {
      const session = requireSession(sessionId);
      const key = idempotencyKeySchema.safeParse(idempotencyKey);
      if (!key.success) {
        throw new ValidationError("Idempotency-Key header is required", {
          "Idempotency-Key": "required",
        });
      }
      const { pnr } = validate(pnrParamsSchema, params);
      const { method } = validate(paymentMethodSchema, body);
      return withIdempotency(
        key.data,
        `${IDEMPOTENCY_SCOPE}:${session}`,
        hashRequest({ pnr, method }),
        async () => {
          const booking = await loadPayable(pnr, session);
          const payment = await createPayment(booking, key.data, method);
          return startPaymentView(payment);
        },
      );
    },

    async payByCard(params, body, sessionId) {
      const session = requireSession(sessionId);
      const { paymentId } = validate(paymentIdParamsSchema, params);
      const card = validate(cardSchema, body);
      const payment = await payments.findForSettlement(paymentId);
      if (!payment || payment.booking.sessionId !== session) {
        throw new NotFoundError("PAYMENT_NOT_FOUND", "Payment not found");
      }
      if (payment.method !== "CARD") {
        throw new ConflictError(
          "INVALID_PAYMENT_METHOD",
          "This payment was not started as a card payment",
        );
      }
      if (payment.status !== "PENDING") {
        throw new ConflictError(
          "INVALID_STATE_TRANSITION",
          `Payment is ${payment.status}; a card can only be submitted while PENDING`,
        );
      }
      // A payment started before expiry may still be submitted during the grace period (AC-MP-06).
      const graceEndsAt =
        payment.booking.holdExpiresAt.getTime() + holdGraceSeconds * 1000;
      if (clock.now() > graceEndsAt) {
        throw new HoldExpiredError();
      }
      const outcome = outcomeForCard(card.cardNumber);
      if (!outcome) {
        throw new UnprocessableError(
          "NOT_A_TEST_CARD",
          "Only the test cards can be used in this mock payment",
        );
      }
      return completePayment({
        paymentId,
        mockRef: payment.mockRef,
        cardLast4: lastFour(card.cardNumber),
        ...outcome,
      });
    },

    handleCallback(body) {
      return completePayment(validate(callbackSchema, body));
    },
  };
}
