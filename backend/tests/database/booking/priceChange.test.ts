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

function changed(
  newPrice: number,
  reason: RepriceResult["reason"],
): RepriceResult {
  return {
    changed: true,
    oldPrice: 1000,
    newPrice,
    perPax: { adult: newPrice, child: 0, infant: 0 },
    reason,
  };
}

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

async function priceChangedDraft(price = 1100) {
  const ctx = await setup({
    reprice: vi.fn().mockResolvedValue(changed(price, "PRICE_UPDATED")),
  });
  const draft = await ctx.draftWithFlight();
  const first = await ctx.putOutbound(draft.draftId, {
    flightId: draft.flightId,
    fareFamily: "LITE",
  });
  return { ...ctx, ...draft, first };
}

describe("PUT /outbound price change", () => {
  it("AC-FS-03: When reprice changed, should respond 409 with old/new/diff/reason and keep the selection unsaved", async () => {
    const { first, draftId } = await priceChangedDraft();

    expect(first.statusCode).toBe(409);
    expect(first.json().error).toMatchObject({
      code: "PRICE_CHANGED",
      oldPrice: 1000,
      newPrice: 1100,
      diff: 100,
      reason: "PRICE_UPDATED",
    });
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row.outboundFlightId).toBeNull();
    expect(row.outboundPendingFareFamily).toBe("LITE");
  });

  it("AC-FS-08: When the fare is sold out, should respond 409 FARE_SOLD_OUT with an alternatives hint", async () => {
    const ctx = await setup({
      reprice: vi.fn().mockResolvedValue(changed(1000, "FARE_SOLD_OUT")),
    });
    const { draftId, flightId } = await ctx.draftWithFlight();

    const res = await ctx.putOutbound(draftId, {
      flightId,
      fareFamily: "LITE",
    });

    expect(res.statusCode).toBe(409);
    const error = res.json().error;
    expect(error.reason).toBe("FARE_SOLD_OUT");
    expect(Array.isArray(error.alternatives)).toBe(true);
    for (const alt of error.alternatives) {
      expect(alt.flightId).not.toBe(flightId);
      expect(alt).toHaveProperty("fromPricePerPax");
    }
  });
});

describe("POST /outbound/accept-price", () => {
  it("AC-FS-04: When the exact new price is posted, should save the selection at the new price", async () => {
    const { send, draftId, flightId } = await priceChangedDraft();

    const res = await send("POST", `/${draftId}/outbound/accept-price`, {
      newPrice: 1100,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      selection: { flightId, fareFamily: "LITE" },
      price: { total: 1100 },
    });
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row).toMatchObject({
      outboundFlightId: flightId,
      outboundFareFamily: "LITE",
      outboundPrice: 1100,
      outboundPendingFlightId: null,
      outboundPendingFareFamily: null,
    });
  });

  it("AC-FS-04: When a different price is posted, should respond 409 again and save nothing", async () => {
    const { send, draftId } = await priceChangedDraft();

    const res = await send("POST", `/${draftId}/outbound/accept-price`, {
      newPrice: 1200,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "PRICE_CHANGED",
      oldPrice: 1200,
      newPrice: 1100,
      diff: -100,
    });
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row.outboundFlightId).toBeNull();
  });

  it("When the pending fare is sold out, should respond 409 FARE_SOLD_OUT", async () => {
    const ctx = await setup({
      reprice: vi.fn().mockResolvedValue(changed(1100, "FARE_SOLD_OUT")),
    });
    const { draftId, flightId } = await ctx.draftWithFlight();
    await ctx.putOutbound(draftId, { flightId, fareFamily: "LITE" });

    const res = await ctx.send("POST", `/${draftId}/outbound/accept-price`, {
      newPrice: 1100,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.reason).toBe("FARE_SOLD_OUT");
  });

  it("When there is no pending price, should respond 409 NO_PENDING_SELECTION", async () => {
    const { send, draftId } = await setup().then(async (ctx) => ({
      ...ctx,
      ...(await ctx.draftWithFlight()),
    }));
    const res = await send("POST", `/${draftId}/outbound/accept-price`, {
      newPrice: 1100,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_PENDING_SELECTION");
  });

  it("When newPrice is not a positive integer, should respond 400", async () => {
    const { send, draftId } = await priceChangedDraft();
    const res = await send("POST", `/${draftId}/outbound/accept-price`, {
      newPrice: "1100",
    });
    expect(res.statusCode).toBe(400);
  });
});
