import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { prisma, SESSION_B, setup, UNKNOWN_ID } from "./harness.js";

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

describe("GET /booking-drafts/:draftId/flights/:flightId/fares", () => {
  it("AC-FS-11: When the flight is in the search, should return the 3 fares with details", async () => {
    const { send, draftWithFlight } = await setup();
    const { draftId, flightId } = await draftWithFlight();

    const res = await send("GET", `/${draftId}/flights/${flightId}/fares`);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.flightId).toBe(flightId);
    expect(body.fares.map((f: { family: string }) => f.family)).toEqual([
      "LITE",
      "VALUE",
      "FLEX",
    ]);
    expect(body.fares[0]).toMatchObject({
      perAdult: expect.any(Number),
      cabinBagKg: expect.any(Number),
      checkedBagKg: expect.any(Number),
      changeAllowed: expect.any(Boolean),
      refundAllowed: expect.any(Boolean),
      seatIncluded: expect.any(Boolean),
    });
  });

  it("AC-FS-11: When the flight, draft or session is unknown, should respond 404", async () => {
    const { send, draftWithFlight } = await setup();
    const { draftId, flightId } = await draftWithFlight();

    const flight = await send("GET", `/${draftId}/flights/${UNKNOWN_ID}/fares`);
    const draft = await send("GET", `/${UNKNOWN_ID}/flights/${flightId}/fares`);
    const other = await send(
      "GET",
      `/${draftId}/flights/${flightId}/fares`,
      undefined,
      SESSION_B,
    );

    expect([flight.statusCode, draft.statusCode, other.statusCode]).toEqual([
      404, 404, 404,
    ]);
  });

  it("AC-FS-11: When the search has expired, should respond 410", async () => {
    const { send, draftWithFlight, clock } = await setup();
    const { draftId, flightId } = await draftWithFlight();
    await clock.advance(20 * 60 * 1000);

    const res = await send("GET", `/${draftId}/flights/${flightId}/fares`);

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("SEARCH_EXPIRED");
  });
});
