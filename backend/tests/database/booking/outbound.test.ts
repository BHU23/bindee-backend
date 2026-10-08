import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildApp } from "@/app.js";
import { ManualClock } from "@/core/utils/clock.js";
import { runSeed } from "@/database/seeds/runSeed.js";
import { createBookingService } from "@/modules/booking/index.js";
import {
  createPrismaInventory,
  type InventoryPort,
  type RepriceResult,
} from "@/modules/inventory/index.js";
import { createSearchService } from "@/modules/search/index.js";
import {
  SEED_DAYS,
  SEED_NOW,
  createTestPrisma,
  resetInventory,
} from "../testDb.js";

const prisma = createTestPrisma();
const SESSION_A = "0b9c7a52-1d2e-4a3b-9c4d-5e6f7a8b9c0d";
const SESSION_B = "6f1d3c8e-2a4b-4c5d-8e9f-0a1b2c3d4e5f";

async function setup(override: Partial<InventoryPort> = {}) {
  const clock = new ManualClock();
  await clock.advance(SEED_NOW.getTime());
  const base = createPrismaInventory({ prisma, clock });
  const inventory: InventoryPort = {
    ...base,
    reprice: vi.fn(base.reprice),
    ...override,
  };
  const searchService = createSearchService({ prisma, clock, inventory });
  const bookingService = createBookingService({ prisma, clock, inventory });
  const app = await buildApp(
    { logger: false },
    { searchService, bookingService },
  );

  async function createSearch(session = SESSION_A): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/searches",
      headers: { "x-session-id": session },
      payload: {
        tripType: "ONE_WAY",
        origin: "BKK",
        destination: "HKT",
        departDate: "2026-10-08",
        adults: 1,
      },
    });
    return res.json().searchId as string;
  }
  function createDraft(payload: unknown, session: string | null = SESSION_A) {
    return app.inject({
      method: "POST",
      url: "/api/v1/booking-drafts",
      headers: session ? { "x-session-id": session } : {},
      payload: payload as object,
    });
  }
  function putOutbound(
    draftId: string,
    payload: unknown,
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method: "PUT",
      url: `/api/v1/booking-drafts/${draftId}/outbound`,
      headers: session ? { "x-session-id": session } : {},
      payload: payload as object,
    });
  }
  async function firstFlightId(searchId: string): Promise<string> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/searches/${searchId}/flights`,
      headers: { "x-session-id": SESSION_A },
    });
    return res.json().flights[0].flightId as string;
  }
  return {
    clock,
    inventory,
    createSearch,
    createDraft,
    putOutbound,
    firstFlightId,
  };
}

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "booking_draft"');
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/v1/booking-drafts", () => {
  it("AC-FS-01: When the searchId is valid, should store a draft with the price snapshot reference", async () => {
    const { createSearch, createDraft } = await setup();
    const searchId = await createSearch();

    const res = await createDraft({ searchId });

    expect(res.statusCode).toBe(201);
    const { draftId } = res.json();
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row).toMatchObject({
      searchId,
      sessionId: SESSION_A,
      tripType: "ONE_WAY",
      adults: 1,
      outboundFlightId: null,
      confirmedAt: null,
    });
  });

  it("When the searchId is not a uuid, should respond 400", async () => {
    const { createDraft } = await setup();
    const res = await createDraft({ searchId: "nope" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("When the session header is missing, should respond 400", async () => {
    const { createSearch, createDraft } = await setup();
    const searchId = await createSearch();
    const res = await createDraft({ searchId }, null);
    expect(res.statusCode).toBe(400);
  });

  it("When the search belongs to another session, should respond 404", async () => {
    const { createSearch, createDraft } = await setup();
    const searchId = await createSearch(SESSION_A);
    const res = await createDraft({ searchId }, SESSION_B);
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/v1/booking-drafts/:draftId/outbound", () => {
  async function draftWithFlight() {
    const ctx = await setup();
    const searchId = await ctx.createSearch();
    const { draftId } = (await ctx.createDraft({ searchId })).json();
    const flightId = await ctx.firstFlightId(searchId);
    return { ...ctx, searchId, draftId, flightId };
  }

  it("AC-FS-02: When selecting a fare, should call InventoryPort.reprice before responding 200", async () => {
    const { inventory, putOutbound, draftId, flightId, searchId } =
      await draftWithFlight();

    const res = await putOutbound(draftId, { flightId, fareFamily: "VALUE" });

    expect(res.statusCode).toBe(200);
    expect(inventory.reprice).toHaveBeenCalledWith({
      searchId,
      flightId,
      fareFamily: "VALUE",
      paxCounts: { adults: 1, children: 0, infants: 0 },
    });
    const body = res.json();
    expect(body.selection).toEqual({ flightId, fareFamily: "VALUE" });
    expect(body.price.total).toBeGreaterThan(0);
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row).toMatchObject({
      outboundFlightId: flightId,
      outboundFareFamily: "VALUE",
      outboundPrice: body.price.total,
    });
    expect(row.outboundArriveAt).toBeInstanceOf(Date);
  });

  it("When selecting twice, should keep the last write", async () => {
    const { putOutbound, draftId, flightId } = await draftWithFlight();
    await putOutbound(draftId, { flightId, fareFamily: "LITE" });
    const res = await putOutbound(draftId, { flightId, fareFamily: "FLEX" });
    expect(res.statusCode).toBe(200);
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row.outboundFareFamily).toBe("FLEX");
  });

  it("When reprice reports a change, should respond 409 PRICE_CHANGED and save nothing", async () => {
    const changed: RepriceResult = {
      changed: true,
      oldPrice: 1000,
      newPrice: 1100,
      perPax: { adult: 1100, child: 0, infant: 0 },
      reason: "PRICE_UPDATED",
    };
    const ctx = await setup({ reprice: vi.fn().mockResolvedValue(changed) });
    const searchId = await ctx.createSearch();
    const { draftId } = (await ctx.createDraft({ searchId })).json();
    const flightId = await ctx.firstFlightId(searchId);

    const res = await ctx.putOutbound(draftId, {
      flightId,
      fareFamily: "LITE",
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
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
  });

  it("When the fare family is unknown, should respond 400", async () => {
    const { putOutbound, draftId, flightId } = await draftWithFlight();
    const res = await putOutbound(draftId, { flightId, fareFamily: "GOLD" });
    expect(res.statusCode).toBe(400);
  });

  it("When the flight is unknown, should respond 404", async () => {
    const { putOutbound, draftId } = await draftWithFlight();
    const res = await putOutbound(draftId, {
      flightId: "00000000-0000-4000-8000-000000000000",
      fareFamily: "LITE",
    });
    expect(res.statusCode).toBe(404);
  });

  it("When the draft belongs to another session or is unknown, should respond 404", async () => {
    const { putOutbound, draftId, flightId } = await draftWithFlight();
    const other = await putOutbound(
      draftId,
      { flightId, fareFamily: "LITE" },
      SESSION_B,
    );
    expect(other.statusCode).toBe(404);
    const unknown = await putOutbound("00000000-0000-4000-8000-000000000000", {
      flightId,
      fareFamily: "LITE",
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("When reprice fails, should respond 503 and save nothing", async () => {
    const { InventoryUnavailableError } =
      await import("@/core/errors/index.js");
    const ctx = await setup({
      reprice: vi.fn().mockRejectedValue(new InventoryUnavailableError()),
    });
    const searchId = await ctx.createSearch();
    const { draftId } = (await ctx.createDraft({ searchId })).json();
    const flightId = await ctx.firstFlightId(searchId);

    const res = await ctx.putOutbound(draftId, {
      flightId,
      fareFamily: "LITE",
    });

    expect(res.statusCode).toBe(503);
    const row = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(row.outboundFlightId).toBeNull();
  });
});
