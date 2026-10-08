import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import type { RepriceResult } from "@/modules/inventory/index.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { prisma, setup } from "./harness.js";

const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
}, 120_000);
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "booking_draft"');
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("PUT /return", () => {
  it("When the return flight departs at least 60 min after the outbound arrives, should save the return fare", async () => {
    const ctx = await setup();
    const { draftId, inboundId } = await ctx.roundTripDraft();
    await prisma.bookingDraft.update({
      where: { id: draftId },
      data: { outboundArriveAt: new Date(Date.now() - 24 * HOUR) },
    });

    const res = await ctx.send("PUT", `/${draftId}/return`, {
      flightId: inboundId,
      fareFamily: "VALUE",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().selection).toEqual({
      flightId: inboundId,
      fareFamily: "VALUE",
    });
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row).toMatchObject({
      returnFlightId: inboundId,
      returnFareFamily: "VALUE",
    });
  });

  it("AC-FS-05: When the return departs less than 60 min after the outbound arrives, should respond 422 RETURN_TOO_EARLY", async () => {
    const ctx = await setup();
    const { draftId, inboundId } = await ctx.roundTripDraft();
    const flights = await prisma.flight.findUniqueOrThrow({
      where: { id: inboundId },
    });
    await prisma.bookingDraft.update({
      where: { id: draftId },
      data: {
        outboundArriveAt: new Date(flights.departAt.getTime() - 59 * 60 * 1000),
      },
    });

    const res = await ctx.send("PUT", `/${draftId}/return`, {
      flightId: inboundId,
      fareFamily: "LITE",
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("RETURN_TOO_EARLY");
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row.returnFlightId).toBeNull();
  });

  it("AC-FS-05: When the return departs exactly 60 min after the outbound arrives, should accept it", async () => {
    const ctx = await setup();
    const { draftId, inboundId } = await ctx.roundTripDraft();
    const flight = await prisma.flight.findUniqueOrThrow({
      where: { id: inboundId },
    });
    await prisma.bookingDraft.update({
      where: { id: draftId },
      data: { outboundArriveAt: new Date(flight.departAt.getTime() - HOUR) },
    });

    const res = await ctx.send("PUT", `/${draftId}/return`, {
      flightId: inboundId,
      fareFamily: "LITE",
    });

    expect(res.statusCode).toBe(200);
  });

  it("AC-FS-06: When the draft is one-way, should respond 422 NOT_ROUND_TRIP", async () => {
    const ctx = await setup();
    const { draftId, flightId } = await ctx.draftWithFlight();

    const res = await ctx.send("PUT", `/${draftId}/return`, {
      flightId,
      fareFamily: "LITE",
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NOT_ROUND_TRIP");
    const list = await ctx.send("GET", `/${draftId}/return-flights`);
    expect(list.statusCode).toBe(422);
  });

  it("When no outbound is selected yet, should respond 409 OUTBOUND_NOT_SELECTED", async () => {
    const ctx = await setup();
    const searchId = await ctx.createSearch(undefined, {
      tripType: "ROUND_TRIP",
      returnDate: "2026-10-10",
    });
    const { draftId } = (await ctx.createDraft({ searchId })).json();
    const inboundId = (await ctx.send("GET", `/${draftId}/return-flights`))
      .statusCode;
    expect(inboundId).toBe(409);
    const res = await ctx.send("PUT", `/${draftId}/return`, {
      flightId: "00000000-0000-4000-8000-000000000000",
      fareFamily: "LITE",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("OUTBOUND_NOT_SELECTED");
  });

  it("When the flight is not an inbound flight of the search, should respond 404", async () => {
    const ctx = await setup();
    const { draftId, flightId } = await ctx.roundTripDraft();
    const res = await ctx.send("PUT", `/${draftId}/return`, {
      flightId,
      fareFamily: "LITE",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /return-flights", () => {
  it("AC-FS-05: When listing, should return only flights departing at least 60 min after the outbound arrival", async () => {
    const ctx = await setup();
    const { draftId } = await ctx.roundTripDraft();
    await prisma.bookingDraft.update({
      where: { id: draftId },
      data: { outboundArriveAt: new Date(0) },
    });
    const all = (await ctx.send("GET", `/${draftId}/return-flights`)).json()
      .flights as { depart: string }[];
    expect(all.length).toBeGreaterThan(1);

    const cut = new Date(all[1]!.depart);
    await prisma.bookingDraft.update({
      where: { id: draftId },
      data: { outboundArriveAt: new Date(cut.getTime() - HOUR) },
    });
    const filtered = (
      await ctx.send("GET", `/${draftId}/return-flights`)
    ).json().flights as { depart: string }[];

    expect(filtered.every((f) => new Date(f.depart) >= cut)).toBe(true);
    expect(filtered.length).toBeLessThan(all.length);
    expect(filtered[0]).toHaveProperty("fromPricePerPax");
  });
});

describe("outbound change", () => {
  it("AC-FS-10: When the outbound is changed, should clear the return selection", async () => {
    const ctx = await setup();
    const { draftId, flightId, inboundId } = await ctx.roundTripDraft();
    await prisma.bookingDraft.update({
      where: { id: draftId },
      data: { outboundArriveAt: new Date(0) },
    });
    await ctx.send("PUT", `/${draftId}/return`, {
      flightId: inboundId,
      fareFamily: "LITE",
    });

    const res = await ctx.putOutbound(draftId, {
      flightId,
      fareFamily: "FLEX",
    });

    expect(res.statusCode).toBe(200);
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row).toMatchObject({
      outboundFareFamily: "FLEX",
      returnFlightId: null,
      returnFareFamily: null,
      returnPrice: null,
    });
  });
});

describe("POST /return/accept-price", () => {
  const changed: RepriceResult = {
    changed: true,
    oldPrice: 1000,
    newPrice: 1100,
    perPax: { adult: 1100, child: 0, infant: 0 },
    reason: "PRICE_UPDATED",
  };

  async function pendingReturn() {
    let pricedFlightId = "";
    const ctx = await setup((base) => ({
      reprice: vi.fn((input) =>
        input.flightId === pricedFlightId
          ? Promise.resolve(changed)
          : base.reprice(input),
      ),
    }));
    const draft = await ctx.roundTripDraft();
    pricedFlightId = draft.inboundId;
    await prisma.bookingDraft.update({
      where: { id: draft.draftId },
      data: { outboundArriveAt: new Date(0) },
    });
    const first = await ctx.send("PUT", `/${draft.draftId}/return`, {
      flightId: draft.inboundId,
      fareFamily: "LITE",
    });
    return { ...ctx, ...draft, first };
  }

  it("AC-FS-12: When the exact new price is posted, should save the return at the new price; a different price gives 409 again", async () => {
    const { send, draftId, inboundId, first } = await pendingReturn();
    expect(first.statusCode).toBe(409);
    expect(first.json().error.code).toBe("PRICE_CHANGED");

    const wrong = await send("POST", `/${draftId}/return/accept-price`, {
      newPrice: 1200,
    });
    expect(wrong.statusCode).toBe(409);

    const ok = await send("POST", `/${draftId}/return/accept-price`, {
      newPrice: 1100,
    });
    expect(ok.statusCode).toBe(200);
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row).toMatchObject({
      returnFlightId: inboundId,
      returnPrice: 1100,
      returnPendingFlightId: null,
    });
    expect(row.outboundPrice).not.toBe(1100);
  });
});
