import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { FIFTEEN_MIN, prisma, SESSION_A, SESSION_B, setup } from "./harness.js";

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

describe("PUT /api/v1/bookings/:pnr/payment-method", () => {
  it("AC-PM-01: When a valid method is saved on a PENDING_PAYMENT booking, should respond 200 with the next page and publish PaymentMethodSelected", async () => {
    const { bookPnr, saveMethod, events } = await setup();
    const { pnr } = await bookPnr();

    const res = await saveMethod(pnr, { method: "CARD" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ method: "CARD", next: "/pay/card" });
    expect(events).toEqual([
      { name: "PaymentMethodSelected", payload: { pnr, method: "CARD" } },
    ]);
    const saved = await prisma.paymentSelection.findMany();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.method).toBe("CARD");
  });

  it("AC-PM-02: When the booking is not PENDING_PAYMENT, should respond 409 INVALID_STATE_TRANSITION and save nothing", async () => {
    const { bookPnr, saveMethod, events } = await setup();
    const { pnr } = await bookPnr();
    await prisma.booking.update({ where: { pnr }, data: { status: "PAID" } });

    const res = await saveMethod(pnr, { method: "CARD" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_STATE_TRANSITION");
    expect(await prisma.paymentSelection.count()).toBe(0);
    expect(events).toEqual([]);
  });

  it("AC-PM-03: When the hold has expired, should respond 410 HOLD_EXPIRED and save nothing", async () => {
    const { bookPnr, saveMethod, clock, events } = await setup();
    const { pnr } = await bookPnr();
    await clock.advance(FIFTEEN_MIN);

    const res = await saveMethod(pnr, { method: "CARD" });

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("HOLD_EXPIRED");
    expect(await prisma.paymentSelection.count()).toBe(0);
    expect(events).toEqual([]);
  });

  it("AC-PM-03: When one millisecond remains on the hold, should still save", async () => {
    const { bookPnr, saveMethod, clock } = await setup();
    const { pnr } = await bookPnr();
    await clock.advance(FIFTEEN_MIN - 1);

    const res = await saveMethod(pnr, { method: "CARD" });

    expect(res.statusCode).toBe(200);
  });

  it("AC-PM-05: When the method is saved twice, should keep one selection holding the later one", async () => {
    const { bookPnr, saveMethod, events } = await setup();
    const { pnr } = await bookPnr();

    await saveMethod(pnr, { method: "CARD" });
    const second = await saveMethod(pnr, { method: "CARD" });

    expect(second.statusCode).toBe(200);
    expect(await prisma.paymentSelection.count()).toBe(1);
    expect(events).toHaveLength(2);
  });

  it("AC-PM-05: When a later save changes the stored method, should replace the earlier one", async () => {
    const { bookPnr, saveMethod } = await setup();
    const { pnr } = await bookPnr();
    const booking = await prisma.booking.findUniqueOrThrow({ where: { pnr } });
    await prisma.paymentSelection.create({
      data: {
        bookingId: booking.id,
        method: "PROMPTPAY_QR",
        createdAt: SEED_NOW,
      },
    });

    await saveMethod(pnr, { method: "CARD" });

    const saved = await prisma.paymentSelection.findMany();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.method).toBe("CARD");
  });

  it("When the method is unknown or missing, should respond 400 VALIDATION_ERROR", async () => {
    const { bookPnr, saveMethod } = await setup();
    const { pnr } = await bookPnr();

    for (const payload of [{ method: "BITCOIN" }, {}, { method: 1 }]) {
      const res = await saveMethod(pnr, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("When the method is PROMPTPAY_QR, should respond 200 with /pay/qr", async () => {
    const { bookPnr, saveMethod } = await setup();
    const { pnr } = await bookPnr();

    const res = await saveMethod(pnr, { method: "PROMPTPAY_QR" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ method: "PROMPTPAY_QR", next: "/pay/qr" });
  });

  it("AC-PM-04: When MOBILE_BANKING is saved without a bank or with a valid bank, should respond 200 with /pay/mobile-banking", async () => {
    const { bookPnr, saveMethod } = await setup();
    const { pnr } = await bookPnr();

    for (const payload of [
      { method: "MOBILE_BANKING" },
      { method: "MOBILE_BANKING", bank: "KBANK" },
      { method: "MOBILE_BANKING", bank: "TTB" },
    ]) {
      const res = await saveMethod(pnr, payload);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        method: "MOBILE_BANKING",
        next: "/pay/mobile-banking",
      });
    }
  });

  it("AC-PM-04: When MOBILE_BANKING is saved with an unknown bank, should respond 400 VALIDATION_ERROR and save nothing", async () => {
    const { bookPnr, saveMethod, events } = await setup();
    const { pnr } = await bookPnr();

    const res = await saveMethod(pnr, {
      method: "MOBILE_BANKING",
      bank: "ACME",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields).toHaveProperty("bank");
    expect(await prisma.paymentSelection.count()).toBe(0);
    expect(events).toEqual([]);
  });

  it("When the PNR is unknown, malformed or belongs to another session, should respond 404 or 400", async () => {
    const { bookPnr, saveMethod } = await setup();
    const { pnr } = await bookPnr();

    const unknown = await saveMethod("ZZZZZZ", { method: "CARD" });
    const otherSession = await saveMethod(pnr, { method: "CARD" }, SESSION_B);
    const malformed = await saveMethod("abc", { method: "CARD" });

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("BOOKING_NOT_FOUND");
    expect(otherSession.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(400);
  });

  it("When X-Session-Id is missing, should respond 400", async () => {
    const { bookPnr, saveMethod } = await setup();
    const { pnr } = await bookPnr();

    const res = await saveMethod(pnr, { method: "CARD" }, null);

    expect(res.statusCode).toBe(400);
    expect(SESSION_A).toBeDefined();
  });
});
