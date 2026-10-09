import { buildApp } from "@/app.js";
import type { DomainEvent, EventBus } from "@/core/events/eventBus.js";
import { InMemoryEventBus } from "@/core/events/inMemoryEventBus.js";
import { createPrismaIdempotencyRepository } from "@/core/repositories/prismaIdempotencyRepository.js";
import { ManualClock } from "@/core/utils/clock.js";
import { createWithIdempotency } from "@/core/utils/idempotency.js";
import { createBookingService } from "@/modules/booking/index.js";
import { createPrismaInventory } from "@/modules/inventory/index.js";
import { createPaymentService } from "@/modules/payment/index.js";
import { createSearchService } from "@/modules/search/index.js";
import { SEED_NOW } from "../testDb.js";
import { prisma, SESSION_A } from "../booking/harness.js";

export { prisma, SESSION_A, SESSION_B } from "../booking/harness.js";
export const FIFTEEN_MIN = 15 * 60 * 1000;

const adult = {
  type: "adult",
  title: "Mr",
  firstName: "Somchai",
  lastName: "Jaidee",
  dob: "1990-05-15",
  gender: "M",
  nationality: "TH",
};
const passengerBody = {
  passengers: [adult],
  contact: {
    name: "Somchai Jaidee",
    email: "somchai@example.com",
    phone: "+66812345678",
  },
  consent: { privacy: true, marketing: false },
};

/** An event bus whose publish can be made to fail, to prove retries do not duplicate payments. */
export class FlakyEventBus implements EventBus {
  failNextPublish = false;
  readonly inner: InMemoryEventBus;
  constructor(clock: ManualClock) {
    this.inner = new InMemoryEventBus({ clock });
  }
  async publish(event: DomainEvent): Promise<void> {
    if (this.failNextPublish) {
      this.failNextPublish = false;
      throw new Error("bus down");
    }
    await this.inner.publish(event);
  }
  subscribe: EventBus["subscribe"] = (name, handler) =>
    this.inner.subscribe(name, handler);
  close = (): Promise<void> => this.inner.close();
}

/** App with booking + payment wired on one manual clock, plus a helper that books a PNR. */
export async function setup(
  options: {
    callbackSecret?: string;
    randomInt?: (max: number) => number;
  } = {},
) {
  const clock = new ManualClock();
  await clock.advance(SEED_NOW.getTime());
  const inventory = createPrismaInventory({ prisma, clock });
  const eventBus = new FlakyEventBus(clock);
  const withIdempotency = createWithIdempotency({
    repository: createPrismaIdempotencyRepository(prisma.idempotencyRecord),
    clock,
  });
  const searchService = createSearchService({ prisma, clock, inventory });
  const bookingService = createBookingService({
    prisma,
    clock,
    inventory,
    eventBus,
    withIdempotency,
  });
  const paymentService = createPaymentService({
    prisma,
    clock,
    eventBus,
    withIdempotency,
    ...(options.randomInt ? { randomInt: options.randomInt } : {}),
  });
  const app = await buildApp(
    { logger: false },
    {
      searchService,
      bookingService,
      paymentService,
      ...(options.callbackSecret
        ? { mockCallbackSecret: options.callbackSecret }
        : {}),
    },
  );

  /** Confirms a one-way booking and returns its PNR (status PENDING_PAYMENT). */
  async function bookPnr(): Promise<{ pnr: string; total: number }> {
    const headers = { "x-session-id": SESSION_A };
    const search = await app.inject({
      method: "POST",
      url: "/api/v1/searches",
      headers,
      payload: {
        tripType: "ONE_WAY",
        origin: "BKK",
        destination: "HKT",
        departDate: "2026-10-08",
        adults: 1,
      },
    });
    const searchId = search.json().searchId as string;
    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/booking-drafts",
      headers,
      payload: { searchId },
    });
    const draftId = draft.json().draftId as string;
    const flights = await app.inject({
      method: "GET",
      url: `/api/v1/searches/${searchId}/flights`,
      headers,
    });
    const flightId = flights.json().flights[0].flightId as string;
    const fare = await app.inject({
      method: "PUT",
      url: `/api/v1/booking-drafts/${draftId}/outbound`,
      headers,
      payload: { flightId, fareFamily: "LITE" },
    });
    await app.inject({
      method: "PUT",
      url: `/api/v1/booking-drafts/${draftId}/passengers`,
      headers,
      payload: passengerBody,
    });
    const total = fare.json().price.total as number;
    const booked = await app.inject({
      method: "POST",
      url: "/api/v1/bookings",
      headers: { ...headers, "idempotency-key": "book-1" },
      payload: { draftId, acceptTerms: true, expectedTotal: total },
    });
    return { pnr: booked.json().pnr as string, total };
  }

  function saveMethod(
    pnr: string,
    payload: unknown,
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method: "PUT",
      url: `/api/v1/bookings/${pnr}/payment-method`,
      headers: session ? { "x-session-id": session } : {},
      payload: payload as object,
    });
  }

  function startPayment(
    pnr: string,
    payload: unknown = { method: "CARD" },
    idempotencyKey: string | null = "pay-1",
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/bookings/${pnr}/payments`,
      headers: {
        ...(session ? { "x-session-id": session } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      payload: payload as object,
    });
  }

  /** Starts a CARD payment for a fresh booking. */
  async function startedPayment(): Promise<{
    pnr: string;
    total: number;
    paymentId: string;
    mockRef: string;
  }> {
    const { pnr, total } = await bookPnr();
    const started = await startPayment(pnr);
    const { paymentId, mockRef } = started.json();
    return { pnr, total, paymentId, mockRef };
  }

  function payByCard(
    paymentId: string,
    payload: unknown,
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/payments/${paymentId}/card`,
      headers: session ? { "x-session-id": session } : {},
      payload: payload as object,
    });
  }

  function callback(payload: unknown, headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: "/api/v1/mock-payment/callback",
      headers,
      payload: payload as object,
    });
  }

  function retryPayment(
    pnr: string,
    payload: unknown = {},
    idempotencyKey: string | null = "retry-1",
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/bookings/${pnr}/payments/retry`,
      headers: {
        ...(session ? { "x-session-id": session } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      payload: payload as object,
    });
  }

  function latestPayment(pnr: string, session: string | null = SESSION_A) {
    return app.inject({
      method: "GET",
      url: `/api/v1/bookings/${pnr}/payments/latest`,
      headers: session ? { "x-session-id": session } : {},
    });
  }

  function getBooking(pnr: string, session: string | null = SESSION_A) {
    return app.inject({
      method: "GET",
      url: `/api/v1/bookings/${pnr}`,
      headers: session ? { "x-session-id": session } : {},
    });
  }

  const events: DomainEvent[] = [];
  for (const name of [
    "PaymentMethodSelected",
    "PaymentPending",
    "PaymentCompleted",
    "PaymentFailed",
    "PaidAfterHoldExpired",
  ] as const) {
    eventBus.subscribe(name, async (event) => {
      events.push(event);
    });
  }

  return {
    app,
    clock,
    eventBus,
    events,
    bookPnr,
    saveMethod,
    startPayment,
    startedPayment,
    payByCard,
    callback,
    retryPayment,
    latestPayment,
    getBooking,
  };
}
