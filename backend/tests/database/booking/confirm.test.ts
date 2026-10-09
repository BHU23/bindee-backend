import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "@/core/events/eventBus.js";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { prisma, setup, SESSION_A, SESSION_B } from "./harness.js";

const FIFTEEN_MIN = 15 * 60 * 1000;
const TWENTY_MIN = 20 * 60 * 1000;
const PNR_PATTERN = /^[A-Z0-9]{6}$/;

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

/** A one-way draft with fare and passenger saved: ready for Confirm booking. */
async function ready() {
  const ctx = await setup();
  const { draftId, flightId } = await ctx.draftWithFlight();
  const fare = await ctx.putOutbound(draftId, {
    flightId,
    fareFamily: "LITE",
  });
  await ctx.send("PUT", `/${draftId}/passengers`, passengerBody);
  const total = fare.json().price.total as number;
  const events: DomainEvent[] = [];
  for (const name of ["BookingCreated", "SeatsHeld"] as const) {
    ctx.eventBus.subscribe(name, async (event) => {
      events.push(event);
    });
  }
  const payload = { draftId, acceptTerms: true, expectedTotal: total };
  return { ...ctx, draftId, flightId, total, payload, events };
}

describe("POST /api/v1/bookings", () => {
  it("AC-RH-01: When the draft is valid, should create a PNR, hold the seats for 15 minutes and respond 201 PENDING_PAYMENT", async () => {
    const { book, payload, total, draftId, flightId } = await ready();

    const res = await book(payload);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pnr).toMatch(PNR_PATTERN);
    expect(body.status).toBe("PENDING_PAYMENT");
    expect(body.total).toBe(total);
    expect(new Date(body.holdExpiresAt).getTime()).toBe(
      SEED_NOW.getTime() + FIFTEEN_MIN,
    );
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { pnr: body.pnr },
    });
    expect(booking).toMatchObject({
      draftId,
      sessionId: SESSION_A,
      status: "PENDING_PAYMENT",
      total,
    });
    const holds = await prisma.seatHold.findMany({
      include: { items: { include: { seat: true } } },
    });
    expect(holds).toHaveLength(1);
    expect(holds[0]?.id).toBe(booking.holdId);
    expect(holds[0]?.items).toHaveLength(1);
    expect(holds[0]?.items[0]?.seat.flightId).toBe(flightId);
    const draft = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(draft.confirmedAt).not.toBeNull();
  });

  it("AC-RH-02: When the same Idempotency-Key and payload are posted twice, should return the same PNR and keep one hold", async () => {
    const { book, payload } = await ready();

    const first = await book(payload, "same-key");
    const second = await book(payload, "same-key");

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await prisma.booking.count()).toBe(1);
    expect(await prisma.seatHold.count()).toBe(1);
  });

  it("AC-RH-02: When the same Idempotency-Key is reused with another payload, should respond 409 IDEMPOTENCY_CONFLICT", async () => {
    const { book, payload } = await ready();
    await book(payload, "same-key");

    const res = await book({ ...payload, expectedTotal: 1 }, "same-key");

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("AC-RH-02: When two requests with the same key race, should create one booking and one hold", async () => {
    const { book, payload } = await ready();

    const [a, b] = await Promise.all([
      book(payload, "race-key"),
      book(payload, "race-key"),
    ]);

    expect(a.json().pnr).toBe(b.json().pnr);
    expect(await prisma.booking.count()).toBe(1);
    expect(await prisma.seatHold.count()).toBe(1);
  });

  it("AC-RH-02: When a booked draft is posted again with a new key, should respond 409 DRAFT_ALREADY_BOOKED and keep one hold", async () => {
    const { book, payload } = await ready();
    await book(payload, "key-a");

    const res = await book(payload, "key-b");

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DRAFT_ALREADY_BOOKED");
    expect(await prisma.seatHold.count()).toBe(1);
  });

  it("AC-RH-03: When expectedTotal differs from the server total, should respond 409 PRICE_CHANGED and create nothing", async () => {
    const { book, payload, total } = await ready();

    const res = await book({ ...payload, expectedTotal: total - 100 });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "PRICE_CHANGED",
      oldPrice: total - 100,
      newPrice: total,
      diff: 100,
    });
    expect(await prisma.booking.count()).toBe(0);
    expect(await prisma.seatHold.count()).toBe(0);
  });

  it("AC-RH-04: When acceptTerms is false, should respond 400 and create nothing", async () => {
    const { book, payload } = await ready();

    const res = await book({ ...payload, acceptTerms: false });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty("acceptTerms");
    expect(await prisma.booking.count()).toBe(0);
  });

  it("AC-RH-04: When acceptTerms is missing, should respond 400", async () => {
    const { book, payload } = await ready();
    const { draftId, expectedTotal } = payload;

    const res = await book({ draftId, expectedTotal });

    expect(res.statusCode).toBe(400);
  });

  it("When the Idempotency-Key header is missing, should respond 400", async () => {
    const { book, payload } = await ready();

    const res = await book(payload, null);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty("Idempotency-Key");
  });

  it("When the session header is missing, should respond 400", async () => {
    const { book, payload } = await ready();

    const res = await book(payload, "key-1", null);

    expect(res.statusCode).toBe(400);
  });

  it("When the draft belongs to another session, should respond 404 DRAFT_NOT_FOUND", async () => {
    const { book, payload } = await ready();

    const res = await book(payload, "key-1", SESSION_B);

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("DRAFT_NOT_FOUND");
  });

  it("AC-RH-11: When the draft expired before Confirm booking, should respond 410 SEARCH_EXPIRED", async () => {
    const { book, payload, clock } = await ready();
    await clock.advance(TWENTY_MIN);

    const res = await book(payload);

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("SEARCH_EXPIRED");
  });

  it("When the outbound fare and passengers are missing, should respond 422 DRAFT_INCOMPLETE listing the steps", async () => {
    const ctx = await setup();
    const { draftId } = await ctx.draftWithFlight();

    const res = await ctx.book({
      draftId,
      acceptTerms: true,
      expectedTotal: 1000,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "DRAFT_INCOMPLETE",
      fields: { outbound: "required", passengers: "required" },
    });
    expect(await prisma.seatHold.count()).toBe(0);
  });

  it("When a round-trip draft has no return fare, should respond 422 DRAFT_INCOMPLETE for the return", async () => {
    const ctx = await setup();
    const { draftId } = await ctx.roundTripDraft();
    await ctx.send("PUT", `/${draftId}/passengers`, passengerBody);

    const res = await ctx.book({
      draftId,
      acceptTerms: true,
      expectedTotal: 1000,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields).toEqual({ return: "required" });
  });

  it("When no seat is left, should respond 409 SEAT_UNAVAILABLE and create no booking", async () => {
    const { book, payload, flightId } = await ready();
    await prisma.seat.updateMany({
      where: { flightId },
      data: { status: "SOLD" },
    });

    const res = await book(payload);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SEAT_UNAVAILABLE");
    expect(await prisma.booking.count()).toBe(0);
  });

  it("When a round-trip draft is complete, should hold both legs and total both fares", async () => {
    const ctx = await setup();
    const { draftId, inboundId } = await ctx.roundTripDraft();
    const back = await ctx.send("PUT", `/${draftId}/return`, {
      flightId: inboundId,
      fareFamily: "LITE",
    });
    await ctx.send("PUT", `/${draftId}/passengers`, passengerBody);
    const out = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    const total = (out.outboundPrice ?? 0) + back.json().price.total;

    const res = await ctx.book({
      draftId,
      acceptTerms: true,
      expectedTotal: total,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().total).toBe(total);
    expect(await prisma.seatHoldItem.count()).toBe(2);
  });

  it("AC-RH-10: When a booking is created, should publish BookingCreated and SeatsHeld once, also on a replay", async () => {
    const { book, payload, events } = await ready();

    const first = await book(payload, "same-key");
    await book(payload, "same-key");

    expect(events.map((e) => e.name).sort()).toEqual([
      "BookingCreated",
      "SeatsHeld",
    ]);
    const pnr = first.json().pnr;
    expect(events.every((e) => e.payload["pnr"] === pnr)).toBe(true);
  });

  it("AC-RH-10: When the booking is rejected, should publish no event", async () => {
    const { book, payload, events } = await ready();

    await book({ ...payload, expectedTotal: 1 });

    expect(events).toEqual([]);
  });
});
