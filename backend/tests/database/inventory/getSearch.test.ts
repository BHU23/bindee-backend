import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock } from "@/core/utils/clock.js";
import { NotFoundError, SearchExpiredError } from "@/core/errors/index.js";
import { runSeed } from "@/database/seeds/runSeed.js";
import { createPrismaInventory } from "@/modules/inventory/repositories/prismaInventory.js";
import { SNAPSHOT_TTL_MS } from "@/modules/inventory/repositories/snapshot.js";
import type { SearchQuery } from "@/modules/inventory/types/inventory.js";
import {
  SEED_DAYS,
  SEED_NOW,
  createTestPrisma,
  resetInventory,
} from "../testDb.js";

const prisma = createTestPrisma();
const SESSION_A = "0b9c7a52-1d2e-4a3b-9c4d-5e6f7a8b9c0d";
const SESSION_B = "6f1d3c8e-2a4b-4c5d-8e9f-0a1b2c3d4e5f";
const QUERY: SearchQuery = {
  tripType: "ROUND_TRIP",
  origin: "BKK",
  destination: "CNX",
  departDate: "2026-10-08",
  returnDate: "2026-10-09",
  adults: 1,
  children: 0,
  infants: 0,
  cabin: "ECONOMY",
};

async function setup() {
  const clock = new ManualClock();
  await clock.advance(SEED_NOW.getTime());
  const inventory = createPrismaInventory({ prisma, clock });
  return { clock, inventory };
}

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AC-INV-21 getSearch", () => {
  it("When the search is fresh, should return query, times and the stored results", async () => {
    const { inventory } = await setup();
    const created = await inventory.searchFlights(QUERY, SESSION_A);

    const stored = await inventory.getSearch({
      searchId: created.searchId,
      sessionId: SESSION_A,
    });

    expect(stored.query).toEqual(QUERY);
    expect(stored.searchedAt).toBe(SEED_NOW.toISOString());
    expect(stored.expiresAt).toBe(
      new Date(SEED_NOW.getTime() + SNAPSHOT_TTL_MS).toISOString(),
    );
    expect(stored.outbound).toEqual(created.outbound);
    expect(stored.inbound).toEqual(created.inbound);
    expect(stored.calendar).toEqual(created.calendar);
  });

  it("When the search is one-way, should return no inbound", async () => {
    const { inventory } = await setup();
    const created = await inventory.searchFlights(
      { ...QUERY, tripType: "ONE_WAY", returnDate: undefined },
      SESSION_A,
    );
    const stored = await inventory.getSearch({
      searchId: created.searchId,
      sessionId: SESSION_A,
    });
    expect(stored.inbound).toBeUndefined();
  });

  it("When the searchId is unknown, should throw NOT_FOUND", async () => {
    const { inventory } = await setup();
    await expect(
      inventory.getSearch({
        searchId: "00000000-0000-4000-8000-000000000000",
        sessionId: SESSION_A,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("When the searchId is not a uuid, should throw NOT_FOUND", async () => {
    const { inventory } = await setup();
    await expect(
      inventory.getSearch({ searchId: "nope", sessionId: SESSION_A }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("When another session asks, should throw NOT_FOUND", async () => {
    const { inventory } = await setup();
    const created = await inventory.searchFlights(QUERY, SESSION_A);
    await expect(
      inventory.getSearch({
        searchId: created.searchId,
        sessionId: SESSION_B,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      inventory.getSearch({ searchId: created.searchId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("When the search had no session, should be readable without one", async () => {
    const { inventory } = await setup();
    const created = await inventory.searchFlights(QUERY);
    const stored = await inventory.getSearch({ searchId: created.searchId });
    expect(stored.query).toEqual(QUERY);
  });

  it("When the snapshot predates v2 (no query), should throw NOT_FOUND", async () => {
    const { inventory } = await setup();
    const legacy = await prisma.searchSnapshot.create({
      data: { createdAt: SEED_NOW, data: { pax: {}, prices: {} } },
    });
    await expect(
      inventory.getSearch({ searchId: legacy.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("When 20 minutes have passed, should still return; after that, should throw SEARCH_EXPIRED carrying the query", async () => {
    const { clock, inventory } = await setup();
    const created = await inventory.searchFlights(QUERY, SESSION_A);
    await clock.advance(SNAPSHOT_TTL_MS);
    await expect(
      inventory.getSearch({ searchId: created.searchId, sessionId: SESSION_A }),
    ).resolves.toBeDefined();

    await clock.advance(1);
    const error = await inventory
      .getSearch({ searchId: created.searchId, sessionId: SESSION_A })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchExpiredError);
    expect((error as SearchExpiredError).query).toEqual(QUERY);
  });

  it("When an expired search is read by another session, should throw NOT_FOUND (no query leak)", async () => {
    const { clock, inventory } = await setup();
    const created = await inventory.searchFlights(QUERY, SESSION_A);
    await clock.advance(SNAPSHOT_TTL_MS + 1);
    await expect(
      inventory.getSearch({ searchId: created.searchId, sessionId: SESSION_B }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
