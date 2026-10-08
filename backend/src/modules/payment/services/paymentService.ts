import { randomInt as cryptoRandomInt } from "node:crypto";
import {
  ConflictError,
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
import { createPaymentRepository } from "../repositories/paymentRepository.js";
import type {
  PaymentMethodResponse,
  StartPaymentResponse,
} from "../types/payment.js";
import {
  idempotencyKeySchema,
  paymentMethodSchema,
  pnrParamsSchema,
} from "../validators/payment.js";
import { paymentMethodView, startPaymentView } from "../views/paymentView.js";

const IDEMPOTENCY_SCOPE = "start-payment";
const PAYABLE_STATUS = "PENDING_PAYMENT";

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
}

export interface PaymentServiceDeps {
  prisma: PrismaClient;
  clock: Clock;
  eventBus: EventBus;
  withIdempotency: WithIdempotency;
  /** Random source for the mock reference; defaults to crypto.randomInt. */
  randomInt?: (max: number) => number;
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
  };
}
