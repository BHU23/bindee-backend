import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock } from "../../../src/core/utils/clock.js";
import { runSeed } from "../../../src/database/seeds/runSeed.js";
import { createPrismaInventory } from "../../../src/modules/inventory/repositories/prismaInventory.js";
import {
  SEED_DAYS,
  SEED_NOW,
  createTestPrisma,
  resetInventory,
} from "../testDb.js";

const prisma = createTestPrisma();
const clock = new ManualClock();
const inventory = createPrismaInventory({ prisma, clock });

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
  await clock.advance(SEED_NOW.getTime());
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

async function flightId(flightNo: string, day: string): Promise<string> {
  const start = new Date(`${day}T00:00:00+07:00`);
  const flight = await prisma.flight.findFirstOrThrow({
    where: {
      flightNo,
      departAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) },
    },
  });
  return flight.id;
}

function dayOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

describe("AC-INV-13 alternatives for a sold-out flight", () => {
  it("When the original day has later flights, should list them first, then nearest other days", async () => {
    const id = await flightId("BN 101", "2026-10-14");

    const result = await inventory.findAlternatives({
      flightId: id,
      paxCount: 1,
      dayWindow: 3,
    });

    const days = result.map((f) => dayOf(f.departAt));
    expect(result.slice(0, 3).map((f) => f.flightNo)).toEqual([
      "BN 102",
      "BN 103",
      "BN 199",
    ]);
    expect(days.slice(0, 3)).toEqual([
      "2026-10-14",
      "2026-10-14",
      "2026-10-14",
    ]);
    expect(days.slice(3, 7)).toEqual([
      "2026-10-13",
      "2026-10-13",
      "2026-10-13",
      "2026-10-13",
    ]);
    expect(days.slice(7, 11)).toEqual([
      "2026-10-15",
      "2026-10-15",
      "2026-10-15",
      "2026-10-15",
    ]);
  });

  it("When listing, should return only the same route and direction within the window and exclude the original", async () => {
    const id = await flightId("BN 102", "2026-10-14");

    const result = await inventory.findAlternatives({
      flightId: id,
      paxCount: 1,
      dayWindow: 3,
    });

    expect(
      result.every((f) => f.origin === "BKK" && f.destination === "CNX"),
    ).toBe(true);
    expect(result.some((f) => f.flightId === id)).toBe(false);
    expect(result.every((f) => !f.soldOut)).toBe(true);
    for (const f of result) {
      expect(
        Math.abs(Date.parse(dayOf(f.departAt)) - Date.parse("2026-10-14")),
      ).toBeLessThanOrEqual(3 * 86_400_000);
    }
  });

  it("When the nearby days are sold out, should skip them", async () => {
    const id = await flightId("BN 101", "2026-10-16");

    const result = await inventory.findAlternatives({
      flightId: id,
      paxCount: 1,
      dayWindow: 1,
    });

    expect(result).toHaveLength(8);
    expect(result.some((f) => dayOf(f.departAt) === "2026-10-16")).toBe(false);
  });

  it("When the party needs 2 seats, should skip BN 199 which has 1 seat left", async () => {
    const id = await flightId("BN 101", "2026-10-14");

    const result = await inventory.findAlternatives({
      flightId: id,
      paxCount: 2,
      dayWindow: 3,
    });

    expect(result.some((f) => f.flightNo === "BN 199")).toBe(false);
    expect(result.every((f) => f.seatsLeft >= 2)).toBe(true);
  });

  it("When dayWindow is 0, should return only later flights of the same day", async () => {
    const id = await flightId("BN 102", "2026-10-14");

    const result = await inventory.findAlternatives({
      flightId: id,
      paxCount: 1,
      dayWindow: 0,
    });

    expect(result.map((f) => f.flightNo)).toEqual(["BN 103", "BN 199"]);
  });

  it("When the flight is unknown, should throw NOT_FOUND", async () => {
    await expect(
      inventory.findAlternatives({
        flightId: "missing",
        paxCount: 1,
        dayWindow: 3,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
