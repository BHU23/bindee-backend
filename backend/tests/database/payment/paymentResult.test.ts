import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { prisma, setup } from "./harness.js";

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

describe("payment-result: callback settles a payment once", () => {
  it("AC-PR-07: When a SUCCESS callback is processed, should make the PNR PAID and publish PaymentCompleted for ticketing", async () => {
    const { startedPayment, callback, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();

    const res = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(res.statusCode).toBe(200);
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    const completed = events.filter((e) => e.name === "PaymentCompleted");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.payload).toMatchObject({ pnr, paymentId });
  });

  it("AC-PR-02: When the same callback is delivered twice, should change the payment and booking once and publish PaymentCompleted once", async () => {
    const { startedPayment, callback, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();

    await callback({ paymentId, result: "SUCCESS", mockRef });
    const settled = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const again = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(again.json()).toEqual({ paymentId, status: "SUCCESS" });
    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(after.completedAt).toEqual(settled.completedAt);
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("AC-PR-02: When a callback arrives late, after the payment was settled by a card submission, should change nothing and publish nothing more", async () => {
    const { startedPayment, payByCard, callback, events } = await setup();
    const { paymentId, mockRef } = await startedPayment();
    await payByCard(paymentId, {
      cardNumber: "4242 4242 4242 4242",
      expiry: "12/30",
      cvv: "123",
    });

    const late = await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(late.json()).toEqual({ paymentId, status: "SUCCESS" });
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("AC-PR-02: When identical callbacks race, should leave one SUCCESS payment and publish PaymentCompleted once", async () => {
    const { startedPayment, callback, getBooking, events } = await setup();
    const { pnr, paymentId, mockRef } = await startedPayment();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        callback({ paymentId, result: "SUCCESS", mockRef }),
      ),
    );

    expect(responses.map((r) => r.statusCode)).toEqual(
      Array.from({ length: 8 }, () => 200),
    );
    expect(await prisma.payment.count({ where: { status: "SUCCESS" } })).toBe(
      1,
    );
    expect((await getBooking(pnr)).json().status).toBe("PAID");
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });

  it("AC-PR-02: When publishing PaymentCompleted fails once, should publish the owed event on the next delivery and no more after that", async () => {
    const { startedPayment, callback, eventBus, events } = await setup();
    const { paymentId, mockRef } = await startedPayment();
    eventBus.failNextPublish = true;

    const first = await callback({ paymentId, result: "SUCCESS", mockRef });
    await callback({ paymentId, result: "SUCCESS", mockRef });
    await callback({ paymentId, result: "SUCCESS", mockRef });

    expect(first.statusCode).toBe(500);
    expect(events.filter((e) => e.name === "PaymentCompleted")).toHaveLength(1);
  });
});
