import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { prisma, setup } from "./harness.js";

const TWENTY_MIN = 20 * 60 * 1000;

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

describe("draft expiry", () => {
  it("AC-FS-07: When the search has expired, should respond 410 SEARCH_EXPIRED on select", async () => {
    const ctx = await setup();
    const { draftId, flightId } = await ctx.draftWithFlight();
    await ctx.clock.advance(TWENTY_MIN);

    const res = await ctx.putOutbound(draftId, {
      flightId,
      fareFamily: "LITE",
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("SEARCH_EXPIRED");
  });

  it("AC-FS-09: When 20 minutes pass before Confirm booking, every draft endpoint should respond 410", async () => {
    const ctx = await setup();
    const { draftId, flightId } = await ctx.roundTripDraft();
    await ctx.clock.advance(TWENTY_MIN);
    const body = { flightId, fareFamily: "LITE" };

    const responses = await Promise.all([
      ctx.putOutbound(draftId, body),
      ctx.send("POST", `/${draftId}/outbound/accept-price`, { newPrice: 1 }),
      ctx.send("PUT", `/${draftId}/return`, body),
      ctx.send("POST", `/${draftId}/return/accept-price`, { newPrice: 1 }),
      ctx.send("GET", `/${draftId}/return-flights`),
      ctx.send("GET", `/${draftId}/flights/${flightId}/fares`),
    ]);

    expect(responses.map((r) => r.statusCode)).toEqual([
      410, 410, 410, 410, 410, 410,
    ]);
  });

  it("AC-FS-09: When Confirm booking has succeeded, the draft should no longer expire", async () => {
    const ctx = await setup();
    const { draftId, flightId } = await ctx.draftWithFlight();
    await prisma.bookingDraft.update({
      where: { id: draftId },
      data: { confirmedAt: new Date() },
    });
    await ctx.clock.advance(TWENTY_MIN);

    const res = await ctx.send("GET", `/${draftId}/flights/${flightId}/fares`);

    expect(res.statusCode).toBe(200);
  });
});
