import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ManualClock } from "../../../src/core/utils/clock.js";
import { runSeed } from "../../../src/database/seeds/runSeed.js";
import { createPrismaInventory } from "../../../src/modules/inventory/repositories/prismaInventory.js";
import type { SearchQuery } from "../../../src/modules/inventory/types/inventory.js";
import {
  SEED_DAYS,
  SEED_NOW,
  createTestPrisma,
  resetInventory,
} from "../testDb.js";

const prisma = createTestPrisma();
const clock = new ManualClock();
const inventory = createPrismaInventory({ prisma, clock });

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    tripType: "ONE_WAY",
    origin: "BKK",
    destination: "CNX",
    departDate: "2026-10-08",
    adults: 1,
    children: 0,
    infants: 0,
    cabin: "ECONOMY",
    ...overrides,
  };
}

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
  await clock.advance(SEED_NOW.getTime());
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AC-INV-02 search BKK→CNX", () => {
  it("When searching a seeded date, should return at least 3 flights with Lite/Value/Flex prices incl. tax", async () => {
    const result = await inventory.searchFlights(query());
    expect(result.outbound.length).toBeGreaterThanOrEqual(3);
    for (const flight of result.outbound) {
      expect(flight.fares.map((f) => f.family)).toEqual([
        "LITE",
        "VALUE",
        "FLEX",
      ]);
      expect(flight.fares.every((f) => f.perAdult > 0)).toBe(true);
    }
    const early = result.outbound.find((f) => f.flightNo === "BN 101");
    expect(early?.fares[0]?.perAdult).toBe(990);
  });

  it("When searching a round trip, should also return the inbound flights of the return day", async () => {
    const result = await inventory.searchFlights(
      query({ tripType: "ROUND_TRIP", returnDate: "2026-10-09" }),
    );
    expect(result.inbound?.length).toBe(4);
    expect(
      result.inbound?.every(
        (f) => f.origin === "CNX" && f.destination === "BKK",
      ),
    ).toBe(true);
  });

  it("When searching, should store a snapshot the caller can reference by searchId", async () => {
    const result = await inventory.searchFlights(query());
    const snapshot = await prisma.searchSnapshot.findUniqueOrThrow({
      where: { id: result.searchId },
    });
    expect(snapshot.createdAt.getTime()).toBe(SEED_NOW.getTime());
  });

  it("When the route is unknown, should return an empty result instead of an error", async () => {
    const result = await inventory.searchFlights(
      query({ origin: "XXX", destination: "YYY" }),
    );
    expect(result.outbound).toEqual([]);
    expect(
      result.calendar.every((d) => d.soldOut && d.lowestFare === null),
    ).toBe(true);
  });

  it("When the input is invalid, should reject it", async () => {
    await expect(
      inventory.searchFlights(query({ adults: 0 })),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("AC-INV-03 calendar", () => {
  it("When results return, should include ±3 days with lowest Lite fare and a sold-out flag", async () => {
    const result = await inventory.searchFlights(
      query({ departDate: "2026-10-15" }),
    );
    expect(result.calendar.map((d) => d.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    function day(date: string) {
      return result.calendar.find((d) => d.date === date);
    }
    expect(day("2026-10-15")).toEqual({
      date: "2026-10-15",
      lowestFare: 921,
      soldOut: false,
    });
    expect(day("2026-10-16")).toEqual({
      date: "2026-10-16",
      lowestFare: null,
      soldOut: true,
    });
  });
});

describe("AC-INV-04 sold-out flights", () => {
  it("When every seat is gone, should mark the flight sold out with 0 seats", async () => {
    const result = await inventory.searchFlights(
      query({ departDate: "2026-10-16" }),
    );
    expect(result.outbound).toHaveLength(4);
    expect(result.outbound.every((f) => f.soldOut && f.seatsLeft === 0)).toBe(
      true,
    );
  });

  it("When the party is larger than the seats left, should mark BN 199 sold out for it only", async () => {
    const solo = await inventory.searchFlights(query());
    const pair = await inventory.searchFlights(query({ adults: 2 }));
    function bn199(r: typeof solo) {
      return r.outbound.find((f) => f.flightNo === "BN 199");
    }
    expect(bn199(solo)).toMatchObject({ seatsLeft: 1, soldOut: false });
    expect(bn199(pair)).toMatchObject({ seatsLeft: 1, soldOut: true });
  });
});

describe("AC-INV-17 international flag", () => {
  it("When searching BKK→SIN, should carry international true; BKK→CNX false", async () => {
    const intl = await inventory.searchFlights(query({ destination: "SIN" }));
    const domestic = await inventory.searchFlights(query());
    expect(intl.international).toBe(true);
    expect(intl.outbound.every((f) => f.international)).toBe(true);
    expect(domestic.international).toBe(false);
  });
});

describe("AC-INV-18 from prices", () => {
  it("When asked for routes over 30 days, should return the lowest Lite adult price incl. taxes", async () => {
    const prices = await inventory.getFromPrices({
      routes: [
        { origin: "BKK", destination: "CNX" },
        { origin: "BKK", destination: "SIN" },
      ],
      days: 30,
    });
    expect(prices).toEqual([
      { origin: "BKK", destination: "CNX", price: 921 },
      { origin: "BKK", destination: "SIN", price: 3540 },
    ]);
  });

  it("When a route has no seats or does not exist, should return no price", async () => {
    await prisma.seat.updateMany({
      where: {
        flight: { route: { originCode: "BKK", destinationCode: "NRT" } },
      },
      data: { status: "SOLD" },
    });
    const prices = await inventory.getFromPrices({
      routes: [
        { origin: "BKK", destination: "NRT" },
        { origin: "XXX", destination: "YYY" },
      ],
      days: 30,
    });
    expect(prices.map((p) => p.price)).toEqual([null, null]);
  });
});
