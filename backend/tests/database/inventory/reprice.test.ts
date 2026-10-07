import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock } from "../../../src/core/utils/clock.js";
import { runSeed } from "../../../src/database/seeds/runSeed.js";
import { createPrismaInventory } from "../../../src/modules/inventory/repositories/prismaInventory.js";
import { SNAPSHOT_TTL_MS } from "../../../src/modules/inventory/repositories/snapshot.js";
import type {
  FareFamily,
  PaxCounts,
  SearchQuery,
} from "../../../src/modules/inventory/types/inventory.js";
import {
  SEED_DAYS,
  SEED_NOW,
  createTestPrisma,
  resetInventory,
} from "../testDb.js";

const prisma = createTestPrisma();
const PAX: PaxCounts = { adults: 1, children: 0, infants: 0 };
const QUERY: SearchQuery = {
  tripType: "ONE_WAY",
  origin: "BKK",
  destination: "CNX",
  departDate: "2026-10-08",
  ...PAX,
  cabin: "ECONOMY",
};

async function newClock(): Promise<ManualClock> {
  const clock = new ManualClock();
  await clock.advance(SEED_NOW.getTime());
  return clock;
}

async function quote(
  inventory: ReturnType<typeof createPrismaInventory>,
  flightNo: string,
  family: FareFamily,
  pax: PaxCounts = PAX,
) {
  const result = await inventory.searchFlights({ ...QUERY, ...pax });
  const flight = result.outbound.find((f) => f.flightNo === flightNo);
  if (!flight) throw new Error(`${flightNo} not found`);
  return {
    searchId: result.searchId,
    flightId: flight.flightId,
    fareFamily: family,
    paxCounts: pax,
  };
}

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AC-INV-07 reprice without a trigger", () => {
  it("When nothing changed, should return changed=false and the snapshot price", async () => {
    const inventory = createPrismaInventory({
      prisma,
      clock: await newClock(),
    });
    const input = await quote(inventory, "BN 102", "LITE");

    const result = await inventory.reprice(input);

    expect(result).toMatchObject({ changed: false, oldPrice: result.newPrice });
    expect(result.reason).toBeUndefined();
  });
});

describe("AC-INV-06 reprice with a trigger", () => {
  it("When INVENTORY_FORCE_PRICE_CHANGE names the flight, should return changed=true with old/new price and reason", async () => {
    const inventory = createPrismaInventory({
      prisma,
      clock: await newClock(),
      forcePriceChangeFlight: "BN 102",
    });
    const input = await quote(inventory, "BN 102", "LITE", {
      adults: 2,
      children: 1,
      infants: 1,
    });

    const result = await inventory.reprice(input);

    expect(result.changed).toBe(true);
    expect(result.reason).toBe("PRICE_UPDATED");
    expect(result.newPrice - result.oldPrice).toBe(300);
    expect(result.perPax.adult).toBe(result.perPax.child);
  });

  it("When the seeded repriceTrigger fare (BN 101 Value) is repriced, should change; other fares should not", async () => {
    const inventory = createPrismaInventory({
      prisma,
      clock: await newClock(),
    });
    const value = await inventory.reprice(
      await quote(inventory, "BN 101", "VALUE"),
    );
    const lite = await inventory.reprice(
      await quote(inventory, "BN 101", "LITE"),
    );
    expect(value).toMatchObject({ changed: true, reason: "PRICE_UPDATED" });
    expect(lite.changed).toBe(false);
  });

  it("When the fare sold out after the search, should report FARE_SOLD_OUT", async () => {
    const inventory = createPrismaInventory({
      prisma,
      clock: await newClock(),
    });
    const input = await quote(inventory, "BN 103", "LITE");
    await prisma.seat.updateMany({
      where: { flightId: input.flightId },
      data: { status: "SOLD" },
    });

    const result = await inventory.reprice(input);

    expect(result).toMatchObject({ changed: true, reason: "FARE_SOLD_OUT" });
  });
});

describe("AC-INV-05 snapshot expiry", () => {
  it("When the snapshot is older than 20 minutes, should throw SEARCH_EXPIRED", async () => {
    const clock = await newClock();
    const inventory = createPrismaInventory({ prisma, clock });
    const input = await quote(inventory, "BN 102", "LITE");

    await clock.advance(SNAPSHOT_TTL_MS + 1);

    await expect(inventory.reprice(input)).rejects.toMatchObject({
      status: 410,
      code: "SEARCH_EXPIRED",
    });
  });

  it("When exactly 20 minutes passed, should still reprice", async () => {
    const clock = await newClock();
    const inventory = createPrismaInventory({ prisma, clock });
    const input = await quote(inventory, "BN 102", "LITE");

    await clock.advance(SNAPSHOT_TTL_MS);

    await expect(inventory.reprice(input)).resolves.toMatchObject({
      changed: false,
    });
  });

  it("When the searchId is unknown, should throw SEARCH_EXPIRED", async () => {
    const inventory = createPrismaInventory({
      prisma,
      clock: await newClock(),
    });
    const input = await quote(inventory, "BN 102", "LITE");
    await expect(
      inventory.reprice({
        ...input,
        searchId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "SEARCH_EXPIRED" });
  });
});

describe("reprice not found cases", () => {
  it("When the flightId is unknown, should throw NOT_FOUND", async () => {
    const inventory = createPrismaInventory({
      prisma,
      clock: await newClock(),
    });
    const input = await quote(inventory, "BN 102", "LITE");
    await expect(
      inventory.reprice({
        ...input,
        flightId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("When the flight was not part of the search, should throw NOT_FOUND", async () => {
    const inventory = createPrismaInventory({
      prisma,
      clock: await newClock(),
    });
    const input = await quote(inventory, "BN 102", "LITE");
    const other = await prisma.flight.findFirstOrThrow({
      where: { flightNo: "BN 201" },
    });
    await expect(
      inventory.reprice({ ...input, flightId: other.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
