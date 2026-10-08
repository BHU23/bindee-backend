import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "@/app.js";
import { InventoryUnavailableError } from "@/core/errors/index.js";
import { ManualClock } from "@/core/utils/clock.js";
import { runSeed } from "@/database/seeds/runSeed.js";
import {
  createPrismaInventory,
  type InventoryPort,
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
const TWENTY_MIN = 20 * 60 * 1000;

interface Card {
  flightId: string;
  flightNo: string;
  from: string;
  to: string;
  depart: string;
  arrive: string;
  duration: number;
  stops: number;
  fromPricePerPax: number;
  seatsLeft: number;
  lowest: boolean;
}

async function setup(inventoryOverride?: Partial<InventoryPort>) {
  const clock = new ManualClock();
  await clock.advance(SEED_NOW.getTime());
  const inventory = {
    ...createPrismaInventory({ prisma, clock }),
    ...inventoryOverride,
  };
  const searchService = createSearchService({ prisma, clock, inventory });
  const app = await buildApp({ logger: false }, { searchService });

  async function create(
    overrides: Record<string, unknown> = {},
    session: string | null = SESSION_A,
  ): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/searches",
      payload: {
        tripType: "ONE_WAY",
        origin: "BKK",
        destination: "HKT",
        departDate: "2026-10-08",
        adults: 1,
        ...overrides,
      },
      headers: session ? { "x-session-id": session } : {},
    });
    return res.json().searchId as string;
  }
  function flights(
    searchId: string,
    qs = "",
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method: "GET",
      url: `/api/v1/searches/${searchId}/flights${qs ? `?${qs}` : ""}`,
      headers: session ? { "x-session-id": session } : {},
    });
  }
  async function cards(searchId: string, qs = ""): Promise<Card[]> {
    return (await flights(searchId, qs)).json().flights;
  }
  return { clock, create, flights, cards };
}

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AC-FR-10 response shape", () => {
  it("When a search is valid, should return query, cards with flightId, priceRange, calendar and times", async () => {
    const { create, flights } = await setup();
    const searchId = await create();
    const res = await flights(searchId, "sort=departure");

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query).toEqual({
      tripType: "ONE_WAY",
      origin: "BKK",
      destination: "HKT",
      departDate: "2026-10-08",
      adults: 1,
      children: 0,
      infants: 0,
      cabin: "ECONOMY",
    });
    expect(body.searchedAt).toBe(SEED_NOW.toISOString());
    expect(body.expiresAt).toBe(
      new Date(SEED_NOW.getTime() + TWENTY_MIN).toISOString(),
    );
    expect(body.flights).toHaveLength(4);
    expect(body.flights[0]).toEqual({
      flightId: expect.any(String),
      flightNo: "BN 201",
      from: "BKK",
      to: "HKT",
      depart: "2026-10-08T00:00:00.000Z",
      arrive: "2026-10-08T01:25:00.000Z",
      duration: 85,
      stops: 0,
      fromPricePerPax: expect.any(Number),
      seatsLeft: 180,
      lowest: expect.any(Boolean),
    });
    expect(body.calendar).toHaveLength(7);
    expect(body.calendar[3]).toEqual({
      date: "2026-10-08",
      lowestFare: expect.any(Number),
      seatsLeft: 4 * 180,
      soldOut: false,
    });
  });

  it("When searching without a session, should be readable without one", async () => {
    const { create, flights } = await setup();
    const searchId = await create({}, null);
    expect((await flights(searchId, "", null)).statusCode).toBe(200);
  });
});

describe("AC-FR-15 stops", () => {
  it("When directOnly is not set, should return 0 and 1-stop flights with stops set", async () => {
    const { create, cards } = await setup();
    const list = await cards(await create(), "sort=departure");
    expect(list.map((c) => [c.flightNo, c.stops])).toEqual([
      ["BN 201", 0],
      ["BN 202", 0],
      ["BN 204", 1],
      ["BN 203", 0],
    ]);
    expect(list.find((c) => c.stops === 1)?.duration).toBe(220);
  });

  it("AC-FR-01 When directOnly=true, should return only 0-stop flights", async () => {
    const { create, cards } = await setup();
    const list = await cards(await create(), "directOnly=true&sort=departure");
    expect(list.map((c) => c.flightNo)).toEqual(["BN 201", "BN 202", "BN 203"]);
  });
});

describe("AC-FR-02 departure bands", () => {
  it("When filtering morning,evening, should return BN 201 (07:00) and BN 203 (19:00)", async () => {
    const { create, cards } = await setup();
    const list = await cards(await create(), "departure=morning,evening");
    expect(list.map((c) => c.flightNo)).toEqual(["BN 201", "BN 203"]);
  });

  it("When filtering afternoon, should return BN 202 (12:00) and the 15:00 1-stop flight", async () => {
    const { create, cards } = await setup();
    const list = await cards(
      await create(),
      "departure=afternoon&sort=departure",
    );
    expect(list.map((c) => c.flightNo)).toEqual(["BN 202", "BN 204"]);
  });

  it("When the origin is NRT, should use Tokyo local time (09:00 JST = morning)", async () => {
    const { create, cards } = await setup();
    const searchId = await create({ origin: "NRT", destination: "BKK" });
    expect(await cards(searchId, "departure=morning")).toHaveLength(1);
    expect(await cards(searchId, "departure=night")).toHaveLength(0);
  });
});

describe("AC-FR-03 / AC-FR-08 price, fare family and price range", () => {
  it("When filtering by price, should keep flights with a family in range and price from it", async () => {
    const { create, flights } = await setup();
    const searchId = await create();
    const all = (await flights(searchId)).json();
    const { min, max } = all.priceRange;
    expect(min).toBeLessThan(max);

    const filtered = (await flights(searchId, `minPrice=${max}`)).json();
    expect(filtered.flights.length).toBeGreaterThan(0);
    for (const c of filtered.flights as Card[]) {
      expect(c.fromPricePerPax).toBe(max);
    }
    expect(filtered.priceRange).toEqual(all.priceRange);
  });

  it("When filtering fare=FLEX, should price from the Flex family and keep the unfiltered priceRange", async () => {
    const { create, flights } = await setup();
    const searchId = await create();
    const all = (await flights(searchId)).json();
    const flex = (await flights(searchId, "fare=FLEX")).json();
    const flexOnly = flex.flights as Card[];
    const lite = all.flights as Card[];
    expect(flexOnly).toHaveLength(4);
    for (const [i, c] of flexOnly.entries()) {
      expect(c.fromPricePerPax).toBeGreaterThan(lite[i]?.fromPricePerPax ?? 0);
    }
    expect(flex.priceRange).toEqual(all.priceRange);
  });

  it("When fare and price are combined, should satisfy both", async () => {
    const { create, flights } = await setup();
    const searchId = await create();
    const { priceRange } = (await flights(searchId)).json();
    const res = await flights(
      searchId,
      `fare=VALUE,FLEX&maxPrice=${priceRange.min}`,
    );
    // Cheapest overall is a Lite fare, so no Value/Flex family fits.
    expect(res.json().flights).toEqual([]);
  });

  it("When filters are applied, should compute priceRange from the whole day, equal to cheapest and dearest family prices", async () => {
    const { create, flights, cards } = await setup();
    const searchId = await create();
    const { priceRange } = (await flights(searchId, "directOnly=true")).json();
    const cheapest = Math.min(
      ...(await cards(searchId)).map((c) => c.fromPricePerPax),
    );
    const dearest = Math.max(
      ...(await cards(searchId, "fare=FLEX")).map((c) => c.fromPricePerPax),
    );
    expect(priceRange).toEqual({ min: cheapest, max: dearest });
  });

  it("When the 1-stop flight (factor 0.85) is cheapest, should carry the lowest badge alone", async () => {
    const { create, cards } = await setup();
    const list = await cards(await create());
    expect(list.filter((c) => c.lowest).map((c) => c.flightNo)).toEqual([
      "BN 204",
    ]);
    const filtered = await cards(await create(), "directOnly=true");
    expect(filtered.some((c) => c.lowest)).toBe(false);
  });
});

describe("AC-FR-04 sort", () => {
  it("When sort=price, should be ascending by price then departure", async () => {
    const { create, cards } = await setup();
    const list = await cards(await create(), "sort=price");
    const prices = list.map((c) => c.fromPricePerPax);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(list[0]?.flightNo).toBe("BN 204");
  });

  it("When sort=departure, should be ascending by departure", async () => {
    const { create, cards } = await setup();
    const list = await cards(await create(), "sort=departure");
    const times = list.map((c) => c.depart);
    expect(times).toEqual([...times].sort());
  });

  it("When sort=duration, should put the shortest first and the 1-stop flight last", async () => {
    const { create, cards } = await setup();
    const list = await cards(await create(), "sort=duration");
    expect(list.map((c) => c.flightNo)).toEqual([
      "BN 201",
      "BN 202",
      "BN 203",
      "BN 204",
    ]);
  });
});

describe("AC-FR-06 / AC-FR-07 empty result and calendar", () => {
  it("When no flight matches, should return flights=[] and the ±3 day calendar", async () => {
    const { create, flights } = await setup();
    const res = await flights(await create(), "maxPrice=1");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.flights).toEqual([]);
    expect(body.calendar.map((d: { date: string }) => d.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(body.calendar[3]).toMatchObject({ soldOut: false, seatsLeft: 720 });
  });

  it("When a day is sold out, should flag soldOut with no price and 0 seats", async () => {
    const { create, flights } = await setup();
    const res = await flights(
      await create({ destination: "CNX", departDate: "2026-10-15" }),
    );
    const sold = res
      .json()
      .calendar.find((d: { date: string }) => d.date === "2026-10-16");
    expect(sold).toEqual({
      date: "2026-10-16",
      lowestFare: null,
      seatsLeft: 0,
      soldOut: true,
    });
  });

  it("AC-FR-06 When the searched day itself is sold out, should return flights=[] with a zero priceRange and a sold-out calendar day", async () => {
    const { create, flights } = await setup();
    const body = (
      await flights(
        await create({ destination: "CNX", departDate: "2026-10-16" }),
      )
    ).json();
    expect(body.flights).toEqual([]);
    expect(body.priceRange).toEqual({ min: 0, max: 0 });
    expect(body.calendar[3].soldOut).toBe(true);
  });
});

describe("AC-FR-13 leg=return", () => {
  const roundTrip = {
    tripType: "ROUND_TRIP",
    departDate: "2026-10-08",
    returnDate: "2026-10-10",
  };

  it("When the search is a round trip, should return the return flights with the same filter rules", async () => {
    const { create, cards } = await setup();
    const searchId = await create(roundTrip);
    const all = await cards(searchId, "leg=return");
    expect(all).toHaveLength(4);
    expect(all.every((c) => c.from === "HKT" && c.to === "BKK")).toBe(true);
    expect(all.every((c) => c.depart.startsWith("2026-10-10"))).toBe(true);
    const direct = await cards(
      searchId,
      "leg=return&directOnly=true&sort=departure",
    );
    expect(direct.map((c) => c.flightNo)).toEqual([
      "BN 211",
      "BN 212",
      "BN 213",
    ]);
  });

  it("When leg is outbound or omitted on a round trip, should return the outbound flights", async () => {
    const { create, cards } = await setup();
    const searchId = await create(roundTrip);
    expect((await cards(searchId, "leg=outbound"))[0]?.from).toBe("BKK");
    expect((await cards(searchId))[0]?.from).toBe("BKK");
  });

  it("When the search is one-way, should return 400", async () => {
    const { create, flights } = await setup();
    const res = await flights(await create(), "leg=return");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields.leg).toBeDefined();
  });
});

describe("AC-FR-12 validation and not found", () => {
  it.each([
    ["sort=cheapest", "sort"],
    ["departure=dawn", "departure"],
    ["departure=morning,dawn", "departure"],
    ["fare=GOLD", "fare"],
    ["directOnly=maybe", "directOnly"],
    ["minPrice=abc", "minPrice"],
    ["maxPrice=-5", "maxPrice"],
    ["maxPrice=1e3", "maxPrice"],
    ["minPrice=500&maxPrice=100", "minPrice"],
    ["leg=sideways", "leg"],
  ])("When the query is %s, should return 400 on %s", async (qs, field) => {
    const { create, flights } = await setup();
    const res = await flights(await create(), qs);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields[field]).toBeDefined();
  });

  it("When optional values are empty, should treat them as unset", async () => {
    const { create, cards } = await setup();
    const list = await cards(
      await create(),
      "leg=&departure=&directOnly=&minPrice=&maxPrice=&fare=&sort=",
    );
    expect(list).toHaveLength(4);
  });

  it("When the searchId is unknown, should return 404 NOT_FOUND", async () => {
    const { flights } = await setup();
    const res = await flights("00000000-0000-4000-8000-000000000000");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("AC-FR-14 session scoping", () => {
  it("When another session or none asks, should return 404 NOT_FOUND", async () => {
    const { create, flights } = await setup();
    const searchId = await create({}, SESSION_A);
    const other = await flights(searchId, "", SESSION_B);
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe("NOT_FOUND");
    expect((await flights(searchId, "", null)).statusCode).toBe(404);
    expect((await flights(searchId, "", SESSION_A)).statusCode).toBe(200);
  });
});

describe("AC-FR-05 / AC-FR-11 expiry", () => {
  it("When the search is older than 20 minutes, should return 410 SEARCH_EXPIRED with the query in the error body", async () => {
    const { clock, create, flights } = await setup();
    const searchId = await create();
    await clock.advance(TWENTY_MIN);
    expect((await flights(searchId)).statusCode).toBe(200);

    await clock.advance(1);
    const res = await flights(searchId);
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatchObject({
      code: "SEARCH_EXPIRED",
      query: {
        tripType: "ONE_WAY",
        origin: "BKK",
        destination: "HKT",
        departDate: "2026-10-08",
        adults: 1,
      },
    });
  });
});

describe("dependency failure", () => {
  it("When the inventory is down, should return 503 INVENTORY_UNAVAILABLE", async () => {
    const { create } = await setup();
    const searchId = await create();
    const down = await setup({
      getSearch: () => Promise.reject(new InventoryUnavailableError()),
    });
    const res = await down.flights(searchId);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("INVENTORY_UNAVAILABLE");
  });
});
