import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ManualClock } from "@/core/utils/clock.js";
import { runSeed } from "@/database/seeds/runSeed.js";
import { createPrismaInventory } from "@/modules/inventory/repositories/prismaInventory.js";
import type { HoldRequest } from "@/modules/inventory/types/inventory.js";
import {
  SEED_DAYS,
  SEED_NOW,
  createTestPrisma,
  resetInventory,
} from "../testDb.js";

const prisma = createTestPrisma();
const TTL = 900;
const BOOKING = "BK-TEST";
let clock: ManualClock;
let inventory: ReturnType<typeof createPrismaInventory>;

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
}, 120_000);

beforeEach(async () => {
  clock = new ManualClock();
  await clock.advance(SEED_NOW.getTime());
  inventory = createPrismaInventory({ prisma, clock });
  await prisma.seatHold.deleteMany();
  await prisma.seat.updateMany({
    where: { flight: { flightNo: { not: "BN 199" } } },
    data: { status: "AVAILABLE" },
  });
});

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

function request(
  id: string,
  overrides: Partial<HoldRequest> = {},
): HoldRequest {
  return {
    bookingRef: BOOKING,
    paxCount: 1,
    ttlSeconds: TTL,
    segments: [{ flightId: id, fareFamily: "LITE" }],
    ...overrides,
  };
}

async function statusOf(
  id: string,
  seatNo: string,
): Promise<string | undefined> {
  const map = await inventory.getSeatMap(id);
  return map.seats.find((s) => `${s.row}${s.letter}` === seatNo)?.status;
}

describe("AC-INV-11 seat map", () => {
  it("When called for a domestic flight, should list every seat with kind, tier price and status", async () => {
    const id = await flightId("BN 102", "2026-10-08");
    const map = await inventory.getSeatMap(id);

    expect(map.aircraft).toBe("A320");
    expect(map.seats).toHaveLength(180);
    function seat(no: string) {
      return map.seats.find((s) => `${s.row}${s.letter}` === no);
    }
    expect(seat("1A")).toMatchObject({
      kind: "WINDOW",
      price: 200,
      status: "AVAILABLE",
    });
    expect(seat("5C")).toMatchObject({ kind: "AISLE", price: 100 });
    expect(seat("12B")).toMatchObject({ kind: "EXIT", price: 300 });
  });

  it("When called for an international flight, should use 250/450/600 tiers", async () => {
    const id = await flightId("BN 401", "2026-10-08");
    const map = await inventory.getSeatMap(id);
    function price(no: string) {
      return map.seats.find((s) => `${s.row}${s.letter}` === no)?.price;
    }
    expect([price("20A"), price("2A"), price("14A")]).toEqual([250, 450, 600]);
  });

  it("When a seat is held, should show HELD and when sold SOLD", async () => {
    const id = await flightId("BN 102", "2026-10-08");
    await inventory.holdSeats(
      request(id, {
        segments: [
          {
            flightId: id,
            fareFamily: "LITE",
            seats: [{ paxIndex: 0, seatNo: "3A" }],
          },
        ],
      }),
    );
    await prisma.seat.updateMany({
      where: { flightId: id, row: 3, letter: "B" },
      data: { status: "SOLD" },
    });

    expect(await statusOf(id, "3A")).toBe("HELD");
    expect(await statusOf(id, "3B")).toBe("SOLD");
    expect(await statusOf(id, "3C")).toBe("AVAILABLE");
  });

  it("When the flight is unknown, should throw NOT_FOUND", async () => {
    await expect(inventory.getSeatMap("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("AC-INV-08 concurrent holds on the last seat", () => {
  it("When two holds race for 1 remaining seat, should let exactly one succeed", async () => {
    for (const day of [
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ]) {
      const id = await flightId("BN 199", day);
      const results = await Promise.allSettled([
        inventory.holdSeats(request(id, { bookingRef: "A" })),
        inventory.holdSeats(request(id, { bookingRef: "B" })),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "SEAT_UNAVAILABLE",
        status: 409,
      });
    }
  });
});

describe("AC-INV-09 hold TTL", () => {
  it("When a hold is made, should expire at hold time + 900 s and stop blocking afterwards", async () => {
    const id = await flightId("BN 199", "2026-10-08");
    const hold = await inventory.holdSeats(request(id));
    expect(hold.expiresAt.getTime()).toBe(SEED_NOW.getTime() + 900_000);
    await expect(
      inventory.holdSeats(request(id, { bookingRef: "B" })),
    ).rejects.toMatchObject({
      code: "SEAT_UNAVAILABLE",
    });

    await clock.advance(900_001);

    await expect(
      inventory.holdSeats(request(id, { bookingRef: "B" })),
    ).resolves.toBeDefined();
  });
});

describe("AC-INV-10 release", () => {
  it("When released twice, should free the seats and make the second call a no-op", async () => {
    const id = await flightId("BN 199", "2026-10-08");
    const hold = await inventory.holdSeats(request(id));

    await inventory.releaseSeats(hold.holdId);
    const first = await prisma.seatHold.findUniqueOrThrow({
      where: { id: hold.holdId },
    });
    await clock.advance(1000);
    await inventory.releaseSeats(hold.holdId);
    const second = await prisma.seatHold.findUniqueOrThrow({
      where: { id: hold.holdId },
    });

    expect(second.releasedAt).toEqual(first.releasedAt);
    await expect(
      inventory.holdSeats(request(id, { bookingRef: "B" })),
    ).resolves.toBeDefined();
  });

  it("When the hold is unknown, should throw NOT_FOUND", async () => {
    await expect(inventory.releaseSeats("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("AC-INV-12 unavailable seats", () => {
  it("When one requested seat is sold, should throw SEAT_UNAVAILABLE and leave no partial hold", async () => {
    const id = await flightId("BN 102", "2026-10-08");
    await prisma.seat.updateMany({
      where: { flightId: id, row: 7, letter: "B" },
      data: { status: "SOLD" },
    });

    await expect(
      inventory.holdSeats(
        request(id, {
          paxCount: 2,
          segments: [
            {
              flightId: id,
              fareFamily: "LITE",
              seats: [
                { paxIndex: 0, seatNo: "7A" },
                { paxIndex: 1, seatNo: "7B" },
              ],
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "SEAT_UNAVAILABLE" });

    expect(await prisma.seatHold.count()).toBe(0);
    expect(await statusOf(id, "7A")).toBe("AVAILABLE");
  });

  it("When a seat is already held, should reject a second hold of it", async () => {
    const id = await flightId("BN 102", "2026-10-08");
    const seats = [{ paxIndex: 0, seatNo: "8A" }];
    await inventory.holdSeats(
      request(id, { segments: [{ flightId: id, fareFamily: "LITE", seats }] }),
    );
    await expect(
      inventory.holdSeats(
        request(id, {
          bookingRef: "B",
          segments: [{ flightId: id, fareFamily: "LITE", seats }],
        }),
      ),
    ).rejects.toMatchObject({ code: "SEAT_UNAVAILABLE" });
  });

  it("When the second segment fails, should roll back the first segment too", async () => {
    const a = await flightId("BN 102", "2026-10-08");
    const b = await flightId("BN 111", "2026-10-09");
    await prisma.seat.updateMany({
      where: { flightId: b },
      data: { status: "SOLD" },
    });

    await expect(
      inventory.holdSeats(
        request(a, {
          segments: [
            { flightId: a, fareFamily: "LITE" },
            { flightId: b, fareFamily: "LITE" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "SEAT_UNAVAILABLE" });
    expect(await prisma.seatHold.count()).toBe(0);
  });

  it("When the flight, seat number or request is invalid, should fail with the right error", async () => {
    const id = await flightId("BN 102", "2026-10-08");
    function seat(seatNo: string) {
      return request(id, {
        segments: [
          {
            flightId: id,
            fareFamily: "LITE",
            seats: [{ paxIndex: 0, seatNo }],
          },
        ],
      });
    }
    await expect(inventory.holdSeats(request("missing"))).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(inventory.holdSeats(seat("99A"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(inventory.holdSeats(seat("1Z"))).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      inventory.holdSeats(request(id, { paxCount: 0 })),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("extendOrRehold", () => {
  it("When the hold is still live, should extend the same hold by its original TTL", async () => {
    const id = await flightId("BN 199", "2026-10-08");
    const hold = await inventory.holdSeats(request(id));
    await clock.advance(600_000);

    const extended = await inventory.extendOrRehold(hold.holdId);

    expect(extended.holdId).toBe(hold.holdId);
    expect(extended.expiresAt.getTime()).toBe(
      SEED_NOW.getTime() + 600_000 + 900_000,
    );
  });

  it("When the hold expired and the seats are free, should re-hold them under a new hold", async () => {
    const id = await flightId("BN 199", "2026-10-08");
    const hold = await inventory.holdSeats(request(id));
    await clock.advance(900_001);

    const rehold = await inventory.extendOrRehold(hold.holdId);

    expect(rehold.holdId).not.toBe(hold.holdId);
    expect(rehold.expiresAt.getTime()).toBe(
      SEED_NOW.getTime() + 900_001 + 900_000,
    );
  });

  it("When the expired hold's seat was taken by someone else, should throw SEAT_UNAVAILABLE", async () => {
    const id = await flightId("BN 199", "2026-10-08");
    const hold = await inventory.holdSeats(request(id));
    await clock.advance(900_001);
    await inventory.holdSeats(request(id, { bookingRef: "B" }));

    await expect(inventory.extendOrRehold(hold.holdId)).rejects.toMatchObject({
      code: "SEAT_UNAVAILABLE",
    });
  });

  it("When the hold is unknown, should throw NOT_FOUND", async () => {
    await expect(inventory.extendOrRehold("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
