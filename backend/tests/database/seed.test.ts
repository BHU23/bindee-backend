import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../src/database/seeds/runSeed.js";
import { createTestPrisma, resetInventory } from "./testDb.js";

const prisma = createTestPrisma();
const NOW = new Date("2026-10-07T03:00:00.000Z");
const DAYS = 12;

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: NOW, days: DAYS });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

async function counts() {
  return {
    airports: await prisma.airport.count(),
    routes: await prisma.route.count(),
    flights: await prisma.flight.count(),
    fares: await prisma.flightFare.count(),
    seats: await prisma.seat.count(),
    promos: await prisma.promoCode.count(),
    addons: await prisma.addonPrice.count(),
  };
}

describe("AC-INV-15 seed on a migrated database", () => {
  it("When seeded, should create airports, 10 directed routes, flights, fares and seats", async () => {
    const c = await counts();
    expect(c.airports).toBe(7);
    expect(c.routes).toBe(10);
    expect(c.flights).toBe(24 * DAYS);
    expect(c.fares).toBe(c.flights * 3);
    expect(c.seats).toBeGreaterThan(c.flights * 180 - 1);
    expect(c.promos).toBe(3);
    expect(c.addons).toBe(11);
  });

  it("When seeded, should create BN 199 with exactly 1 seat left", async () => {
    const flights = await prisma.flight.findMany({
      where: { flightNo: "BN 199" },
      include: { seats: { where: { status: "AVAILABLE" } } },
    });
    const open = flights.filter((f) => f.seats.length > 0);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((f) => f.seats.length === 1)).toBe(true);
  });

  it("When seeded, should sell out every BKK→CNX flight at run date + 9", async () => {
    const day9Start = new Date("2026-10-16T00:00:00+07:00");
    const day9End = new Date("2026-10-17T00:00:00+07:00");
    const flights = await prisma.flight.findMany({
      where: {
        departAt: { gte: day9Start, lt: day9End },
        route: { originCode: "BKK", destinationCode: "CNX" },
      },
      include: { seats: { where: { status: "AVAILABLE" } } },
    });
    expect(flights).toHaveLength(4);
    expect(flights.every((f) => f.seats.length === 0)).toBe(true);
  });
});

describe("AC-INV-17 international flag in data", () => {
  it("When seeded, should flag BKK↔SIN and BKK↔NRT as international only", async () => {
    const routes = await prisma.route.findMany();
    const international = routes
      .filter((r) => r.international)
      .map((r) => `${r.originCode}-${r.destinationCode}`)
      .sort();
    expect(international).toEqual(["BKK-NRT", "BKK-SIN", "NRT-BKK", "SIN-BKK"]);
  });
});

describe("AC-INV-14 seed idempotency", () => {
  it("When the seed runs twice, should not duplicate data", async () => {
    const before = await counts();
    await runSeed(prisma, { now: NOW, days: DAYS });
    expect(await counts()).toEqual(before);
  }, 120_000);
});

describe("AC-INV-14 seed repairs a partially seeded flight", () => {
  it("When a flight lost its fares and seats, should restore them without duplicating others", async () => {
    const flight = await prisma.flight.findFirstOrThrow({
      where: { flightNo: "BN 102" },
    });
    await prisma.flightFare.deleteMany({ where: { flightId: flight.id } });
    await prisma.seat.deleteMany({ where: { flightId: flight.id } });
    const before = await counts();

    await runSeed(prisma, { now: NOW, days: DAYS });

    const after = await counts();
    expect(after.fares).toBe(before.fares + 3);
    expect(after.seats).toBe(before.seats + 180);
    expect(after.flights).toBe(before.flights);
  }, 120_000);
});
