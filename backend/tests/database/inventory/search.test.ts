import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ManualClock } from "@/core/utils/clock.js";
import { runSeed } from "@/database/seeds/runSeed.js";
import { createPrismaInventory } from "@/modules/inventory/repositories/prismaInventory.js";
import type { SearchQuery } from "@/modules/inventory/types/inventory.js";
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
      seatsLeft: result.outbound.reduce((n, f) => n + f.seatsLeft, 0),
      soldOut: false,
    });
    expect(day("2026-10-16")).toEqual({
      date: "2026-10-16",
      lowestFare: null,
      seatsLeft: 0,
      soldOut: true,
    });
  });
});

describe("AC-INV-19/20 stops and timezone on flight options", () => {
  it("AC-INV-19 When searching BKK→HKT, should expose stops (0 and 1) and the real 3h40 duration of the 1-stop flight", async () => {
    const result = await inventory.searchFlights(query({ destination: "HKT" }));
    expect(result.outbound.map((f) => [f.flightNo, f.stops])).toEqual([
      ["BN 201", 0],
      ["BN 202", 0],
      ["BN 204", 1],
      ["BN 203", 0],
    ]);
    const oneStop = result.outbound.find((f) => f.stops === 1);
    expect(oneStop?.durationMinutes).toBe(220);
    expect(result.outbound[0]?.durationMinutes).toBe(85);
  });

  it("AC-INV-20 When searching, should expose the IANA timezone of the departure airport", async () => {
    const domestic = await inventory.searchFlights(query());
    expect(domestic.outbound[0]?.departTimezone).toBe("Asia/Bangkok");
    const tokyo = await inventory.searchFlights(
      query({ origin: "NRT", destination: "BKK" }),
    );
    expect(tokyo.outbound[0]?.departTimezone).toBe("Asia/Tokyo");
  });
});

describe("AC-INV-22 calendar seats left", () => {
  it("When a party exceeds BN 199's last seat, should not count that flight's seats", async () => {
    const solo = await inventory.searchFlights(query());
    const pair = await inventory.searchFlights(query({ adults: 2 }));
    function today(r: typeof solo): number {
      return r.calendar.find((d) => d.date === "2026-10-08")?.seatsLeft ?? -1;
    }
    expect(today(solo) - today(pair)).toBe(
      solo.outbound.find((f) => f.flightNo === "BN 199")?.seatsLeft,
    );
  });
});

describe("AC-INV-21 snapshot stores query and session", () => {
  it("When searching with a session, should store query and sessionId in the snapshot", async () => {
    const q = query();
    const result = await inventory.searchFlights(q, "session-1");
    const snapshot = await prisma.searchSnapshot.findUniqueOrThrow({
      where: { id: result.searchId },
    });
    expect(snapshot.data).toMatchObject({ query: q, sessionId: "session-1" });
  });

  it("When searching without a session, should store sessionId null", async () => {
    const result = await inventory.searchFlights(query());
    const snapshot = await prisma.searchSnapshot.findUniqueOrThrow({
      where: { id: result.searchId },
    });
    expect(snapshot.data).toMatchObject({ sessionId: null });
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

describe("AC-INV-18 from prices: behaviour kept while computing in SQL", () => {
  const pairs = [
    { origin: "BKK", destination: "CNX" },
    { origin: "BKK", destination: "HKT" },
    { origin: "BKK", destination: "SIN" },
  ];
  function today(): Date {
    return new Date(clock.now());
  }

  /** Independent oracle: Lite adult fare of each flight in the window that still has a free seat. */
  async function liteFlights(pair: { origin: string; destination: string }) {
    const flights = await prisma.flight.findMany({
      where: {
        route: { originCode: pair.origin, destinationCode: pair.destination },
        departAt: {
          gte: today(),
          lt: new Date(today().getTime() + 30 * 86_400_000),
        },
        seats: {
          some: {
            status: "AVAILABLE",
            holdItems: { none: { hold: { releasedAt: null } } },
          },
        },
      },
      include: { fares: { where: { family: "LITE" } } },
    });
    return flights.flatMap((f) =>
      f.fares.map((fare) => ({
        id: f.id,
        price:
          Math.round(fare.basePrice * f.priceFactor.toNumber()) +
          fare.airportTax +
          fare.fuelSurcharge +
          fare.serviceFee,
      })),
    );
  }
  function lowest(rows: { price: number }[]): number | null {
    return rows.length ? Math.min(...rows.map((r) => r.price)) : null;
  }

  it("When several routes are asked, should match the cheapest Lite price of each route computed independently", async () => {
    const prices = await inventory.getFromPrices({ routes: pairs, days: 30 });
    const expected = await Promise.all(
      pairs.map(async (p) => lowest(await liteFlights(p))),
    );
    expect(prices.map((p) => p.price)).toEqual(expected);
    expect(prices.map((p) => `${p.origin}-${p.destination}`)).toEqual(
      pairs.map((p) => `${p.origin}-${p.destination}`),
    );
  });

  it("When days is 0, should return no price because no flight departs inside an empty window", async () => {
    const prices = await inventory.getFromPrices({
      routes: pairs.slice(0, 1),
      days: 0,
    });
    expect(prices.map((p) => p.price)).toEqual([null]);
  });

  it("When the cheapest flight is fully covered by a live hold, should price from the remaining flights", async () => {
    const rows = await liteFlights(pairs[0]!);
    const cheapest = rows.reduce((a, b) => (b.price < a.price ? b : a));
    const others = rows.filter((r) => r.id !== cheapest.id);
    const seats = await prisma.seat.findMany({
      where: { flightId: cheapest.id, status: "AVAILABLE" },
      select: { id: true },
    });
    const hold = await prisma.seatHold.create({
      data: {
        bookingRef: "PERF-TEST",
        expiresAt: new Date(today().getTime() + 15 * 60_000),
        items: { create: seats.map((s) => ({ seatId: s.id })) },
      },
    });
    try {
      const [result] = await inventory.getFromPrices({
        routes: pairs.slice(0, 1),
        days: 30,
      });
      expect(result?.price).toBe(lowest(others));
    } finally {
      await prisma.seatHold.delete({ where: { id: hold.id } });
    }
  });

  it("When routes are asked, should hit the database with one query and not load flights or fares", async () => {
    const raw = vi.spyOn(prisma, "$queryRaw");
    const findMany = vi.spyOn(prisma.flight, "findMany");
    try {
      await inventory.getFromPrices({ routes: pairs, days: 30 });
      expect(raw).toHaveBeenCalledTimes(1);
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      raw.mockRestore();
      findMany.mockRestore();
    }
  });
});
