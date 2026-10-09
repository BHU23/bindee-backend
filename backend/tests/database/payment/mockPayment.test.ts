import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { FIFTEEN_MIN, prisma, SESSION_A, SESSION_B, setup } from "./harness.js";

const SUCCESS_CARD = {
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/30",
  cvv: "123",
};
const DECLINED_CARD = {
  cardNumber: "4000 0000 0000 0002",
  expiry: "12/30",
  cvv: "123",
};
const TIMEOUT_CARD = {
  cardNumber: "4000 0000 0000 0119",
  expiry: "12/30",
  cvv: "123",
};
const GRACE_MS = 60_000;

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

describe("POST /api/v1/payments/:paymentId/card", () => {
  it("AC-MP-02, AC-MP-10: When the success card is submitted, should settle SUCCESS, make the booking PAID and publish PaymentCompleted once", async () => {
    const { startedPayment, payByCard, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();

    const res = await payByCard(paymentId, SUCCESS_CARD);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ paymentId, status: "SUCCESS" });
    const booking = await getBooking(pnr);
    expect(booking.statusCode).toBe(200);
    expect(booking.json()).toMatchObject({
      pnr,
      status: "PAID",
      paymentReference: mockRef,
    });
    expect(mockRef).toMatch(/^MOCK-\d{8}-[A-Z0-9]{6}$/);
    const completed = events.filter((e) => e.name === "PaymentCompleted");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.payload).toMatchObject({ pnr, paymentId });
  });

  it("AC-MP-03: When the declined card is submitted, should settle FAILED MOCK_DECLINED and publish PaymentFailed", async () => {
    const { startedPayment, payByCard, getBooking, events } = await setup();
    const { pnr, paymentId } = await startedPayment();

    const res = await payByCard(paymentId, DECLINED_CARD);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      paymentId,
      status: "FAILED",
      failureCode: "MOCK_DECLINED",
    });
    expect((await getBooking(pnr)).json().status).toBe("PAYMENT_FAILED");
    expect((await getBooking(pnr)).json()).not.toHaveProperty(
      "paymentReference",
    );
    expect(events.filter((e) => e.name === "PaymentFailed")).toHaveLength(1);
    expect(events.some((e) => e.name === "PaymentCompleted")).toBe(false);
  });

  it("AC-MP-04: When the timeout card is submitted, should settle FAILED MOCK_TIMEOUT", async () => {
    const { startedPayment, payByCard } = await setup();
    const { paymentId } = await startedPayment();

    const res = await payByCard(paymentId, TIMEOUT_CARD);

    expect(res.json()).toEqual({
      paymentId,
      status: "FAILED",
      failureCode: "MOCK_TIMEOUT",
    });
  });

  it("AC-MP-09: When a card is submitted, should persist only its last 4 digits", async () => {
    const { startedPayment, payByCard } = await setup();
    const { paymentId } = await startedPayment();

    await payByCard(paymentId, SUCCESS_CARD);

    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(stored.cardLast4).toBe("4242");
    expect(JSON.stringify(stored)).not.toContain("4242424242424242");
    expect(JSON.stringify(stored)).not.toContain("123");
  });

  it("AC-MP-12: When the card data is malformed, should respond 400 naming the fields and charge nothing", async () => {
    const { startedPayment, payByCard, events } = await setup();
    const { paymentId } = await startedPayment();

    for (const [payload, field] of [
      [{ ...SUCCESS_CARD, cardNumber: "4242" }, "cardNumber"],
      [{ ...SUCCESS_CARD, expiry: "13/30" }, "expiry"],
      [{ ...SUCCESS_CARD, cvv: "12" }, "cvv"],
    ] as const) {
      const res = await payByCard(paymentId, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toHaveProperty(field);
    }
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(stored.status).toBe("PENDING");
    expect(events.some((e) => e.name === "PaymentCompleted")).toBe(false);
  });

  it("AC-MP-12: When the expiry is well formed but in the past, should accept it", async () => {
    const { startedPayment, payByCard } = await setup();
    const { paymentId } = await startedPayment();

    const res = await payByCard(paymentId, {
      ...SUCCESS_CARD,
      expiry: "01/20",
    });

    expect(res.statusCode).toBe(200);
  });

  it("AC-MP-13: When a well-formed number is not a test card, should respond 422 NOT_A_TEST_CARD and keep the payment PENDING", async () => {
    const { startedPayment, payByCard } = await setup();
    const { paymentId } = await startedPayment();

    const res = await payByCard(paymentId, {
      ...SUCCESS_CARD,
      cardNumber: "4111 1111 1111 1111",
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NOT_A_TEST_CARD");
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(stored.status).toBe("PENDING");
  });

  it("AC-MP-06: When the hold and the grace period have passed, should respond 410 HOLD_EXPIRED and leave the payment PENDING", async () => {
    const { startedPayment, payByCard, clock } = await setup();
    const { paymentId } = await startedPayment();
    await clock.advance(FIFTEEN_MIN + GRACE_MS + 1_000);

    const res = await payByCard(paymentId, SUCCESS_CARD);

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("HOLD_EXPIRED");
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(stored.status).toBe("PENDING");
  });

  it("AC-MP-06: When a card is submitted after the hold expired but within the grace period, should settle normally and make the booking PAID", async () => {
    const { startedPayment, payByCard, getBooking, clock, events } =
      await setup();
    const { pnr, paymentId } = await startedPayment();
    await clock.advance(FIFTEEN_MIN + GRACE_MS - 1_000);

    const res = await payByCard(paymentId, SUCCESS_CARD);

    expect(res.statusCode).toBe(200);
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("When the payment is already settled, should respond 409 INVALID_STATE_TRANSITION", async () => {
    const { startedPayment, payByCard } = await setup();
    const { paymentId } = await startedPayment();
    await payByCard(paymentId, SUCCESS_CARD);

    const res = await payByCard(paymentId, SUCCESS_CARD);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("When the payment belongs to another session, is unknown or the session is missing, should respond 404 or 400", async () => {
    const { startedPayment, payByCard } = await setup();
    const { paymentId } = await startedPayment();

    expect(
      (await payByCard(paymentId, SUCCESS_CARD, SESSION_B)).statusCode,
    ).toBe(404);
    expect(
      (await payByCard("00000000-0000-4000-8000-000000000000", SUCCESS_CARD))
        .statusCode,
    ).toBe(404);
    expect((await payByCard(paymentId, SUCCESS_CARD, null)).statusCode).toBe(
      400,
    );
    expect((await payByCard("not-a-uuid", SUCCESS_CARD)).statusCode).toBe(400);
  });

  it("When the payment was not started as a card payment, should respond 409 INVALID_PAYMENT_METHOD", async () => {
    const { bookPnr, startPayment, payByCard } = await setup();
    const { pnr } = await bookPnr();
    const { paymentId } = (
      await startPayment(pnr, { method: "PROMPTPAY_QR" })
    ).json();

    const res = await payByCard(paymentId, SUCCESS_CARD);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_PAYMENT_METHOD");
  });
});

describe("POST /api/v1/mock-payment/callback", () => {
  it("AC-MP-07: When a SUCCESS callback arrives, should make the booking PAID through the same path as the card", async () => {
    const { startedPayment, callback, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();

    const res = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(res.statusCode).toBe(200);
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("AC-MP-02: When the same callback is delivered twice, should change and publish once", async () => {
    const { startedPayment, callback, events } = await setup();
    const { paymentId, mockRef } = await startedPayment();

    const first = await callback({ paymentId, result: "SUCCESS", mockRef });
    const second = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(first.json()).toEqual(second.json());
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("AC-MP-02: When two identical callbacks race, should publish PaymentCompleted once", async () => {
    const { startedPayment, callback, events } = await setup();
    const { paymentId, mockRef } = await startedPayment();

    await Promise.all([
      callback({ paymentId, result: "SUCCESS", mockRef }),
      callback({ paymentId, result: "SUCCESS", mockRef }),
    ]);

    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("AC-MP-02: When many identical callbacks race, should answer every one 200 SUCCESS and publish PaymentCompleted once", async () => {
    const { startedPayment, callback, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        callback({ paymentId, result: "SUCCESS", mockRef }),
      ),
    );

    expect(responses.map((r) => r.statusCode)).toEqual(
      Array.from({ length: 12 }, () => 200),
    );
    expect(responses.every((r) => r.json().status === "SUCCESS")).toBe(true);
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("When a FAILED callback arrives after SUCCESS, should ignore it", async () => {
    const { startedPayment, callback, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();
    await callback({ paymentId, result: "SUCCESS", mockRef });

    const res = await callback({
      paymentId,
      result: "FAILED",
      mockRef,
      failureCode: "MOCK_DECLINED",
    });

    expect(res.json().status).toBe("SUCCESS");
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.some((e) => e.name === "PaymentFailed")).toBe(false);
  });

  it("AC-MP-05: When the payment amount differs from the booking total, should respond 422 AMOUNT_MISMATCH and change nothing", async () => {
    const { startedPayment, callback, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();
    await prisma.payment.update({
      where: { id: paymentId },
      data: { amount: 1 },
    });

    const res = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("AMOUNT_MISMATCH");
    expect((await getBooking(pnr)).json().status).toBe("PENDING_PAYMENT");
    expect(events.some((e) => e.name === "PaymentCompleted")).toBe(false);
  });

  it("When the mockRef does not belong to the payment, should respond 422 MOCK_REF_MISMATCH", async () => {
    const { startedPayment, callback } = await setup();
    const { paymentId } = await startedPayment();

    const res = await callback({
      paymentId,
      result: "SUCCESS",
      mockRef: "MOCK-20261007-ZZZZZZ",
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("MOCK_REF_MISMATCH");
  });

  it("When the callback is malformed or the payment is unknown, should respond 400 or 404", async () => {
    const { callback } = await setup();

    expect((await callback({ result: "SUCCESS" })).statusCode).toBe(400);
    expect(
      (
        await callback({
          paymentId: "00000000-0000-4000-8000-000000000000",
          result: "SUCCESS",
          mockRef: "x",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("AC-MP-06: When a success arrives after the hold expired but within the grace period, should make the booking PAID normally", async () => {
    const { startedPayment, callback, getBooking, clock, events } =
      await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();
    await clock.advance(FIFTEEN_MIN + GRACE_MS - 1_000);

    await callback({ paymentId, result: "SUCCESS", mockRef });

    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
    expect(events.some((e) => e.name === "PaidAfterHoldExpired")).toBe(false);
  });

  it("AC-MP-06: When a success arrives after the grace period, should record the payment, leave the booking and publish PaidAfterHoldExpired", async () => {
    const { startedPayment, callback, getBooking, clock, events } =
      await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();
    await clock.advance(FIFTEEN_MIN + GRACE_MS + 1_000);

    const res = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(res.json().status).toBe("SUCCESS");
    expect((await getBooking(pnr)).json().status).toBe("PENDING_PAYMENT");
    expect(
      events.filter((e) => e.name === "PaidAfterHoldExpired"),
    ).toHaveLength(1);
    expect(events.some((e) => e.name === "PaymentCompleted")).toBe(false);
  });

  it("AC-MP-06: When a success arrives for a booking already HOLD_EXPIRED, should publish PaidAfterHoldExpired", async () => {
    const { startedPayment, callback, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();
    await prisma.booking.update({
      where: { pnr },
      data: { status: "HOLD_EXPIRED" },
    });

    await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(
      events.filter((e) => e.name === "PaidAfterHoldExpired"),
    ).toHaveLength(1);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { pnr } })).status,
    ).toBe("HOLD_EXPIRED");
  });

  it("When the booking is already PAID by another payment, should record this success without changing the booking or publishing PaymentCompleted", async () => {
    const { startedPayment, callback, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();
    await prisma.booking.update({ where: { pnr }, data: { status: "PAID" } });

    const res = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("SUCCESS");
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(stored.status).toBe("SUCCESS");
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { pnr } })).status,
    ).toBe("PAID");
    expect(events.some((e) => e.name === "PaymentCompleted")).toBe(false);
  });

  it("When a FAILED callback is delivered twice, should return the failureCode both times and publish PaymentFailed once", async () => {
    const { startedPayment, callback, events } = await setup();
    const { paymentId, mockRef } = await startedPayment();
    const failed = {
      paymentId,
      result: "FAILED",
      mockRef,
      failureCode: "MOCK_TIMEOUT",
    };

    const first = await callback(failed);
    const second = await callback(failed);

    expect(first.json()).toEqual({
      paymentId,
      status: "FAILED",
      failureCode: "MOCK_TIMEOUT",
    });
    expect(second.json()).toEqual(first.json());
    expect(events.filter((e) => e.name === "PaymentFailed")).toHaveLength(1);
  });

  it("AC-MP-02: When publishing PaymentCompleted fails, should answer an error and publish it when the callback is delivered again", async () => {
    const { startedPayment, callback, eventBus, getBooking, events } =
      await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();
    eventBus.failNextPublish = true;

    const first = await callback({ paymentId, result: "SUCCESS", mockRef });
    expect(first.statusCode).toBe(500);
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.some((e) => e.name === "PaymentCompleted")).toBe(false);

    const retry = await callback({ paymentId, result: "SUCCESS", mockRef });
    const again = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(retry.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });
});

describe("POST /api/v1/mock-payment/callback with MOCK_CALLBACK_SECRET", () => {
  const SECRET = "demo-secret-0123456789";

  it("When the secret is missing or wrong, should respond 401 and leave the payment PENDING", async () => {
    const { startedPayment, callback } = await setup({
      callbackSecret: SECRET,
    });
    const { paymentId, mockRef } = await startedPayment();
    const body = { paymentId, result: "SUCCESS", mockRef };

    expect((await callback(body)).statusCode).toBe(401);
    const wrong = await callback(body, { "x-callback-secret": "nope" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("UNAUTHORIZED");
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(stored.status).toBe("PENDING");
  });

  it("When the secret matches, should settle the payment", async () => {
    const { startedPayment, callback } = await setup({
      callbackSecret: SECRET,
    });
    const { paymentId, mockRef } = await startedPayment();

    const res = await callback(
      { paymentId, result: "SUCCESS", mockRef },
      { "x-callback-secret": SECRET },
    );

    expect(res.statusCode).toBe(200);
  });

  it("When a secret is configured, should still let the guest pay by card without it", async () => {
    const { startedPayment, payByCard } = await setup({
      callbackSecret: SECRET,
    });
    const { paymentId } = await startedPayment();

    expect((await payByCard(paymentId, SUCCESS_CARD)).statusCode).toBe(200);
  });
});

describe("GET /api/v1/bookings/:pnr", () => {
  it("AC-MP-10: When the booking is not paid, should return its read model without a payment reference", async () => {
    const { bookPnr, getBooking } = await setup();
    const { pnr, total } = await bookPnr();

    const res = await getBooking(pnr);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      pnr,
      status: "PENDING_PAYMENT",
      total,
      holdExpiresAt: new Date(SEED_NOW.getTime() + FIFTEEN_MIN).toISOString(),
    });
  });

  it("When the PNR is unknown, malformed or belongs to another session, should respond 404 or 400", async () => {
    const { bookPnr, getBooking } = await setup();
    const { pnr } = await bookPnr();

    expect((await getBooking(pnr, SESSION_B)).statusCode).toBe(404);
    expect((await getBooking("ZZZZZZ")).statusCode).toBe(404);
    expect((await getBooking("abc")).statusCode).toBe(400);
    expect((await getBooking(pnr, null)).statusCode).toBe(400);
    expect(SESSION_A).not.toBe(SESSION_B);
  });
});
