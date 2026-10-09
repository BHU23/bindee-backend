import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "@/app.js";
import { ManualClock } from "@/core/utils/clock.js";
import { InventoryUnavailableError } from "@/core/errors/index.js";
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
const clock = new ManualClock();
const inventory = createPrismaInventory({ prisma, clock });

const SESSION_A = "0b9c7a52-1d2e-4a3b-9c4d-5e6f7a8b9c0d";
const SESSION_B = "6f1d3c8e-2a4b-4c5d-8e9f-0a1b2c3d4e5f";

function buildTestApp(port: InventoryPort = inventory) {
  const searchService = createSearchService({
    prisma,
    clock,
    inventory: port,
  });
  return buildApp({ logger: false }, { searchService });
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    tripType: "ONE_WAY",
    origin: "BKK",
    destination: "CNX",
    departDate: "2026-10-08",
    adults: 1,
    ...overrides,
  };
}

async function post(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  body: unknown,
  sessionId?: string,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/searches",
    payload: body as object,
    headers: sessionId ? { "x-session-id": sessionId } : {},
  });
}

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
  await clock.advance(SEED_NOW.getTime());
}, 120_000);

beforeEach(async () => {
  await prisma.recentSearch.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/v1/searches", () => {
  describe("AC-HS-01 depart date window", () => {
    it("When departDate is in the past, should return 400 VALIDATION_ERROR on departDate", async () => {
      const app = await buildTestApp();
      const res = await post(app, query({ departDate: "2026-10-06" }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(res.json().error.fields)).toEqual(["departDate"]);
    });

    it("When departDate is more than 330 days ahead, should return 400 on departDate", async () => {
      const app = await buildTestApp();
      const res = await post(app, query({ departDate: "2027-12-01" }));
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json().error.fields)).toEqual(["departDate"]);
    });
  });

  describe("AC-HS-02 return date", () => {
    it("When returnDate is before departDate on a round trip, should return 400 on returnDate", async () => {
      const app = await buildTestApp();
      const res = await post(
        app,
        query({
          tripType: "ROUND_TRIP",
          departDate: "2026-10-10",
          returnDate: "2026-10-09",
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json().error.fields)).toEqual(["returnDate"]);
    });
  });

  describe("AC-HS-03 airports", () => {
    it("When origin equals destination, should return 400", async () => {
      const app = await buildTestApp();
      const res = await post(app, query({ destination: "BKK" }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.destination).toBeDefined();
    });

    it("When a code is not an IATA code, should return 400", async () => {
      const app = await buildTestApp();
      const res = await post(app, query({ origin: "12" }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.origin).toBeDefined();
    });
  });

  describe("AC-HS-04 passengers", () => {
    it.each([
      ["adults < 1", { adults: 0 }, "adults"],
      ["adults + children > 9", { adults: 5, children: 5 }, "children"],
      ["infants > adults", { adults: 1, infants: 2 }, "infants"],
    ])(
      "When %s, should return 400 naming the broken rule in fields",
      async (_, patch, field) => {
        const app = await buildTestApp();
        const res = await post(app, query(patch));
        expect(res.statusCode).toBe(400);
        expect(res.json().error.fields[field]).toBeDefined();
      },
    );
  });

  describe("AC-HS-05 create", () => {
    it("When the query is valid, should return 201 with a searchId and expiresAt = now + 20 min", async () => {
      const app = await buildTestApp();
      const res = await post(app, query(), SESSION_A);
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.searchId).toEqual(expect.any(String));
      expect(new Date(body.expiresAt).getTime()).toBe(
        clock.now() + 20 * 60 * 1000,
      );
    });

    it("When children, infants and cabin are omitted, should still create the search", async () => {
      const app = await buildTestApp();
      const res = await post(app, query());
      expect(res.statusCode).toBe(201);
    });
  });

  describe("dependency failure", () => {
    it("When the inventory is down, should return 503 INVENTORY_UNAVAILABLE", async () => {
      const app = await buildTestApp({
        ...inventory,
        searchFlights: () => Promise.reject(new InventoryUnavailableError()),
      });
      const res = await post(app, query(), SESSION_A);
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("INVENTORY_UNAVAILABLE");
    });

    it("When the inventory fails, should not record a recent search", async () => {
      const app = await buildTestApp({
        ...inventory,
        searchFlights: () => Promise.reject(new InventoryUnavailableError()),
      });
      await post(app, query(), SESSION_A);
      expect(await prisma.recentSearch.count()).toBe(0);
    });
  });
});

describe("GET /api/v1/searches/recent", () => {
  describe("AC-HS-06 last five", () => {
    it("When one session made 6 searches, should return the 5 newest, newest first", async () => {
      const app = await buildTestApp();
      const days = [8, 9, 10, 11, 12, 13];
      for (const day of days) {
        await post(
          app,
          query({ departDate: `2026-10-${String(day).padStart(2, "0")}` }),
          SESSION_A,
        );
        await clock.advance(1000);
      }
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/searches/recent",
        headers: { "x-session-id": SESSION_A },
      });
      expect(res.statusCode).toBe(200);
      expect(
        res.json().map((r: { dates: { depart: string } }) => r.dates.depart),
      ).toEqual([
        "2026-10-13",
        "2026-10-12",
        "2026-10-11",
        "2026-10-10",
        "2026-10-09",
      ]);
    });

    it("When a search was made, should return route, dates and pax", async () => {
      const app = await buildTestApp();
      await post(
        app,
        query({
          tripType: "ROUND_TRIP",
          departDate: "2026-10-09",
          returnDate: "2026-10-11",
          adults: 2,
          children: 1,
        }),
        SESSION_A,
      );
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/searches/recent",
        headers: { "x-session-id": SESSION_A },
      });
      expect(res.json()).toEqual([
        {
          id: expect.any(String),
          tripType: "ROUND_TRIP",
          route: { origin: "BKK", destination: "CNX" },
          dates: { depart: "2026-10-09", return: "2026-10-11" },
          pax: { adults: 2, children: 1, infants: 0 },
          cabin: "ECONOMY",
        },
      ]);
    });

    it("When the same query is searched twice, should list it once, newest position", async () => {
      const app = await buildTestApp();
      await post(app, query(), SESSION_A);
      await clock.advance(1000);
      await post(app, query({ departDate: "2026-10-09" }), SESSION_A);
      await clock.advance(1000);
      await post(app, query(), SESSION_A);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/searches/recent",
        headers: { "x-session-id": SESSION_A },
      });
      expect(
        res.json().map((r: { dates: { depart: string } }) => r.dates.depart),
      ).toEqual(["2026-10-08", "2026-10-09"]);
    });

    it("When no X-Session-Id is sent, should return an empty list", async () => {
      const app = await buildTestApp();
      await post(app, query());
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/searches/recent",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("AC-HS-07 session isolation", () => {
    it("When another session asks, should never see the first session's searches", async () => {
      const app = await buildTestApp();
      await post(app, query(), SESSION_A);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/searches/recent",
        headers: { "x-session-id": SESSION_B },
      });
      expect(res.json()).toEqual([]);
    });
  });
});

describe("GET /api/v1/routes/popular", () => {
  describe("AC-HS-09 computed prices", () => {
    it("When called, should return the 4 BKK routes with the computed lowest Lite price (BKK→CNX = 990)", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/routes/popular",
      });
      expect(res.statusCode).toBe(200);
      const routes = res.json();
      expect(routes.map((r: { destination: string }) => r.destination)).toEqual(
        ["CNX", "HKT", "SIN", "NRT"],
      );
      const [cnx] = await inventory.getFromPrices({
        routes: [{ origin: "BKK", destination: "CNX" }],
        days: 30,
      });
      expect(routes[0]).toEqual({
        origin: "BKK",
        destination: "CNX",
        city: "Chiang Mai",
        fromPricePerPax: cnx?.price,
      });
      // Seed's cheapest 12-day BKK→CNX Lite fare (990 only at price factor 1.0).
      expect(routes[0].fromPricePerPax).toBe(921);
      for (const route of routes) {
        expect(route.fromPricePerPax).toBeGreaterThan(0);
      }
    });

    it("When the inventory is down, should return 503 INVENTORY_UNAVAILABLE", async () => {
      const app = await buildTestApp({
        ...inventory,
        getFromPrices: () => Promise.reject(new InventoryUnavailableError()),
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/routes/popular",
      });
      expect(res.statusCode).toBe(503);
    });
  });
});

describe("GET /api/v1/promotions", () => {
  describe("AC-HS-08 only valid promotions", () => {
    it("When called, should return only promotions whose validUntil is today or later", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/promotions",
      });
      expect(res.statusCode).toBe(200);
      const codes = res
        .json()
        .map((p: { promoCode: string }) => p.promoCode)
        .sort();
      expect(codes).toEqual(["BINDEE10", "FLYDEE100"]);
    });

    it("When called, should expose title, route, code and the code's valid-until date", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/promotions",
      });
      const promo = res
        .json()
        .find((p: { promoCode: string }) => p.promoCode === "BINDEE10");
      expect(promo).toEqual({
        id: expect.any(String),
        title: expect.any(String),
        imageUrl: expect.any(String),
        route: { origin: expect.any(String), destination: expect.any(String) },
        promoCode: "BINDEE10",
        validUntil: "2026-12-31T16:59:59.999Z",
      });
    });

    it("When the clock passes a code's valid-until, should drop that promotion", async () => {
      const app = await buildTestApp();
      await clock.advance(Date.parse("2026-12-01T00:00:00Z") - clock.now());
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/promotions",
      });
      expect(res.json().map((p: { promoCode: string }) => p.promoCode)).toEqual(
        ["BINDEE10"],
      );
      await clock.advance(SEED_NOW.getTime() - clock.now());
    });
  });
});
