import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { FIFTEEN_MIN, prisma, SESSION_B, setup } from "./harness.js";

const DECLINED_CARD = {
  cardNumber: "4000 0000 0000 0002",
  expiry: "12/30",
  cvv: "123",
};
const SUCCESS_CARD = {
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/30",
  cvv: "123",
};

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
}, 120_000);
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "booking_draft", "seat_hold_item", "seat_hold", "idempotency_record" CASCADE',
  );
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** A booking whose first card payment was declined (PNR PAYMENT_FAILED). */
async function failedBooking() {
  const harness = await setup();
  const started = await harness.startedPayment();
  await harness.payByCard(started.paymentId, DECLINED_CARD);
  return { ...harness, ...started };
}

describe("POST /api/v1/bookings/:pnr/payments/retry", () => {
  it("AC-PR-01: When a failed payment is retried within the hold, should create a new payment, keep the previous FAILED and return the PNR to PENDING_PAYMENT", async () => {
    const { pnr, paymentId, retryPayment, getBooking, events } =
      await failedBooking();

    const res = await retryPayment(pnr);

    expect(res.statusCode).toBe(201);
    const retried = res.json();
    expect(retried).toMatchObject({ status: "PENDING", currency: "THB" });
    expect(retried.paymentId).not.toBe(paymentId);
    const previous = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(previous).toMatchObject({
      status: "FAILED",
      failureCode: "MOCK_DECLINED",
    });
    expect((await getBooking(pnr)).json().status).toBe("PENDING_PAYMENT");
    expect(
      events.filter(
        (e) =>
          e.name === "PaymentPending" &&
          (e.payload as { paymentId: string }).paymentId === retried.paymentId,
      ),
    ).toHaveLength(1);
  });

  it("AC-PR-01: When the retried payment succeeds, should make the PNR PAID", async () => {
    const { pnr, retryPayment, payByCard, getBooking } = await failedBooking();
    const { paymentId } = (await retryPayment(pnr)).json();

    const paid = await payByCard(paymentId, SUCCESS_CARD);

    expect(paid.json().status).toBe("SUCCESS");
    expect((await getBooking(pnr)).json().status).toBe("PAID");
  });

  it("When the body names no method, should reuse the previous method; when it names one, should use it", async () => {
    const { pnr, retryPayment, payByCard } = await failedBooking();

    const reused = (await retryPayment(pnr)).json();
    await payByCard(reused.paymentId, DECLINED_CARD);
    const switched = (
      await retryPayment(pnr, { method: "PROMPTPAY_QR" }, "retry-2")
    ).json();

    const methods = await prisma.payment.findMany({
      where: { id: { in: [reused.paymentId, switched.paymentId] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, method: true },
    });
    expect(Object.fromEntries(methods.map((p) => [p.id, p.method]))).toEqual({
      [reused.paymentId]: "CARD",
      [switched.paymentId]: "PROMPTPAY_QR",
    });
  });

  it("AC-PR-03: When the same Idempotency-Key is sent twice, should create one new payment and return it both times", async () => {
    const { pnr, retryPayment } = await failedBooking();

    const first = await retryPayment(pnr, {}, "retry-same");
    const second = await retryPayment(pnr, {}, "retry-same");

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await prisma.payment.count()).toBe(2);
  });

  it("AC-PR-03: When two retries with different keys race, should create one new payment and reject the other with 409", async () => {
    const { pnr, retryPayment } = await failedBooking();

    const responses = await Promise.all([
      retryPayment(pnr, {}, "tab-1"),
      retryPayment(pnr, {}, "tab-2"),
    ]);

    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count()).toBe(2);
  });

  it("AC-PR-04: When a payment already succeeded for the PNR, should respond 409 ALREADY_PAID to a retry and to a new start, and record no second charge", async () => {
    const { pnr, paymentId, retryPayment, startPayment, payByCard } =
      await (async () => {
        const harness = await setup();
        return { ...harness, ...(await harness.startedPayment()) };
      })();
    await payByCard(paymentId, SUCCESS_CARD);

    const retry = await retryPayment(pnr);
    const start = await startPayment(pnr, { method: "CARD" }, "pay-2");

    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("ALREADY_PAID");
    expect(start.statusCode).toBe(409);
    expect(start.json().error.code).toBe("ALREADY_PAID");
    expect(await prisma.payment.count()).toBe(1);
  });

  it("AC-PR-05: When the hold has expired, should respond 410 HOLD_EXPIRED and create no payment", async () => {
    const { pnr, retryPayment, clock } = await failedBooking();
    await clock.advance(FIFTEEN_MIN);

    const res = await retryPayment(pnr);

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("HOLD_EXPIRED");
    expect(await prisma.payment.count()).toBe(1);
  });

  it("AC-PR-12: When 5 payments in a row have failed within a live hold, should still accept another retry", async () => {
    const { pnr, retryPayment, payByCard } = await failedBooking();
    for (let attempt = 2; attempt <= 5; attempt++) {
      const { paymentId } = (
        await retryPayment(pnr, {}, `retry-${attempt}`)
      ).json();
      await payByCard(paymentId, DECLINED_CARD);
    }
    expect(await prisma.payment.count({ where: { status: "FAILED" } })).toBe(5);

    const sixth = await retryPayment(pnr, {}, "retry-6");

    expect(sixth.statusCode).toBe(201);
  });

  it("When the latest payment is still PENDING, should respond 409 and not start a second payment", async () => {
    const { startedPayment, retryPayment } = await setup();
    const { pnr } = await startedPayment();

    const res = await retryPayment(pnr);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_STATE_TRANSITION");
    expect(await prisma.payment.count()).toBe(1);
  });

  it("When the key, session or body is invalid, or the PNR belongs to another session, should respond 400 or 404", async () => {
    const { pnr, retryPayment } = await failedBooking();

    expect((await retryPayment(pnr, {}, null)).statusCode).toBe(400);
    expect((await retryPayment(pnr, {}, "k", null)).statusCode).toBe(400);
    expect((await retryPayment(pnr, { method: "CASH" })).statusCode).toBe(400);
    expect((await retryPayment(pnr, {}, "k", SESSION_B)).statusCode).toBe(404);
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe("payment failure keeps the seats", () => {
  it("AC-PR-06: When a payment fails, should publish PaymentFailed once and release no seats", async () => {
    const { pnr, paymentId, mockRef, callback, events } = await failedBooking();
    await callback({
      paymentId,
      result: "FAILED",
      mockRef,
      failureCode: "MOCK_DECLINED",
    });

    expect(events.filter((e) => e.name === "PaymentFailed")).toHaveLength(1);
    const { holdId } = await prisma.booking.findUniqueOrThrow({
      where: { pnr },
    });
    const hold = await prisma.seatHold.findUniqueOrThrow({
      where: { id: holdId },
      include: { items: true },
    });
    expect(hold.releasedAt).toBeNull();
    expect(hold.items.length).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/bookings/:pnr/payments/latest", () => {
  it("When the latest payment failed, should return its status, failure code and card ending", async () => {
    const { pnr, paymentId, latestPayment } = await failedBooking();

    const res = await latestPayment(pnr);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      paymentId,
      status: "FAILED",
      failureCode: "MOCK_DECLINED",
      cardLast4: "0002",
    });
  });

  it("When a retry was started, should return the new PENDING payment", async () => {
    const { pnr, retryPayment, latestPayment } = await failedBooking();
    const { paymentId } = (await retryPayment(pnr)).json();

    expect((await latestPayment(pnr)).json()).toEqual({
      paymentId,
      status: "PENDING",
    });
  });

  it("When the booking has no payment, belongs to another session or the session is missing, should respond 404 or 400", async () => {
    const { bookPnr, latestPayment } = await setup();
    const { pnr } = await bookPnr();

    expect((await latestPayment(pnr)).json().error.code).toBe(
      "PAYMENT_NOT_FOUND",
    );
    expect((await latestPayment(pnr, SESSION_B)).statusCode).toBe(404);
    expect((await latestPayment(pnr, null)).statusCode).toBe(400);
  });
});
