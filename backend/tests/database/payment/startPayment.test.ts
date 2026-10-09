import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { FIFTEEN_MIN, prisma, SESSION_B, setup } from "./harness.js";

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

describe("POST /api/v1/bookings/:pnr/payments", () => {
  it("AC-PM-06: When a payment is started, should respond 201 PENDING with the booking total and a payment window within the hold", async () => {
    const { bookPnr, startPayment, events } = await setup();
    const { pnr, total } = await bookPnr();

    const res = await startPayment(pnr);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      status: "PENDING",
      amount: total,
      currency: "THB",
    });
    expect(body.paymentId).toEqual(expect.any(String));
    expect(body.mockRef).toMatch(/^MOCK-20261007-[A-Z0-9]{6}$/);
    expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(
      SEED_NOW.getTime() + FIFTEEN_MIN,
    );
    expect(await prisma.payment.count()).toBe(1);
    expect(events).toEqual([
      {
        name: "PaymentPending",
        payload: { pnr, paymentId: body.paymentId },
      },
    ]);
  });

  it("AC-PM-06: When the same Idempotency-Key is sent twice, should return the same paymentId and create one payment", async () => {
    const { bookPnr, startPayment } = await setup();
    const { pnr } = await bookPnr();

    const first = await startPayment(pnr, { method: "CARD" }, "same-key");
    const second = await startPayment(pnr, { method: "CARD" }, "same-key");

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await prisma.payment.count()).toBe(1);
  });

  it("AC-PM-06: When two requests with the same key race, should create one payment", async () => {
    const { bookPnr, startPayment } = await setup();
    const { pnr } = await bookPnr();

    const [a, b] = await Promise.all([
      startPayment(pnr, { method: "CARD" }, "race-key"),
      startPayment(pnr, { method: "CARD" }, "race-key"),
    ]);

    expect(a.json().paymentId).toBe(b.json().paymentId);
    expect(await prisma.payment.count()).toBe(1);
  });

  it("AC-PM-06: When a key is reused for another PNR, should respond 409 IDEMPOTENCY_CONFLICT", async () => {
    const { bookPnr, startPayment } = await setup();
    const { pnr } = await bookPnr();
    await startPayment(pnr, { method: "CARD" }, "same-key");

    const res = await startPayment("ZZZZZZ", { method: "CARD" }, "same-key");

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("AC-PM-07: When the first attempt fails after the payment was stored and the user retries with the same key, should return that payment and not create a duplicate", async () => {
    const { bookPnr, startPayment, eventBus } = await setup();
    const { pnr } = await bookPnr();
    eventBus.failNextPublish = true;

    const failed = await startPayment(pnr, { method: "CARD" }, "retry-key");
    const retried = await startPayment(pnr, { method: "CARD" }, "retry-key");

    expect(failed.statusCode).toBe(500);
    expect(retried.statusCode).toBe(201);
    expect(await prisma.payment.count()).toBe(1);
    const stored = await prisma.payment.findFirstOrThrow();
    expect(retried.json().paymentId).toBe(stored.id);
  });

  it("AC-PM-07: When the start-payment request fails, should keep the saved method", async () => {
    const { bookPnr, saveMethod, startPayment, eventBus } = await setup();
    const { pnr } = await bookPnr();
    await saveMethod(pnr, { method: "CARD" });
    eventBus.failNextPublish = true;

    await startPayment(pnr, { method: "CARD" }, "retry-key");

    const saved = await prisma.paymentSelection.findMany();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.method).toBe("CARD");
  });

  it("AC-PM-02: When the booking is not PENDING_PAYMENT, should respond 409 INVALID_STATE_TRANSITION and create no payment", async () => {
    const { bookPnr, startPayment } = await setup();
    const { pnr } = await bookPnr();
    await prisma.booking.update({
      where: { pnr },
      data: { status: "PAYMENT_FAILED" },
    });

    const res = await startPayment(pnr);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_STATE_TRANSITION");
    expect(await prisma.payment.count()).toBe(0);
  });

  it("AC-PM-03: When the hold has expired, should respond 410 HOLD_EXPIRED and create no payment", async () => {
    const { bookPnr, startPayment, clock } = await setup();
    const { pnr } = await bookPnr();
    await clock.advance(FIFTEEN_MIN);

    const res = await startPayment(pnr);

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("HOLD_EXPIRED");
    expect(await prisma.payment.count()).toBe(0);
  });

  it("When the Idempotency-Key header is missing, should respond 400", async () => {
    const { bookPnr, startPayment } = await setup();
    const { pnr } = await bookPnr();

    const res = await startPayment(pnr, { method: "CARD" }, null);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toEqual({ "Idempotency-Key": "required" });
  });

  it("When the method is invalid, should respond 400 VALIDATION_ERROR and create no payment", async () => {
    const { bookPnr, startPayment } = await setup();
    const { pnr } = await bookPnr();

    const res = await startPayment(pnr, { method: "CASH" });

    expect(res.statusCode).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("When the PNR belongs to another session or no session is sent, should respond 404 or 400", async () => {
    const { bookPnr, startPayment } = await setup();
    const { pnr } = await bookPnr();

    const other = await startPayment(pnr, { method: "CARD" }, "k1", SESSION_B);
    const none = await startPayment(pnr, { method: "CARD" }, "k2", null);

    expect(other.statusCode).toBe(404);
    expect(none.statusCode).toBe(400);
  });
});
