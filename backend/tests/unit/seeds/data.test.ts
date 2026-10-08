import { describe, expect, it } from "vitest";
import {
  AIRCRAFT_LAYOUTS,
  buildFlightPlans,
  buildRoutePlans,
  bangkokMidnight,
  buildSeatPlans,
  priceFactorForHour,
  ROUTE_CONFIGS,
  AIRPORTS,
} from "@/database/seeds/data.js";

const NOW = new Date("2026-10-07T03:00:00.000Z");

describe("AC-INV-15 seed plan", () => {
  it("When building routes, should return 5 pairs in both directions", () => {
    const routes = buildRoutePlans();
    expect(routes).toHaveLength(10);
    expect(routes.filter((r) => r.international)).toHaveLength(4);
  });

  it("When building 120 days, should create the per-route flights per day", () => {
    const plans = buildFlightPlans(NOW, 120);
    const perDay = ROUTE_CONFIGS.reduce(
      (n, c) => n + (c.flightsPerDay + (c.connecting ? 1 : 0)) * 2,
      0,
    );
    expect(plans).toHaveLength(perDay * 120);
  });

  it("AC-INV-19 When planning BKK↔HKT, should add one 1-stop flight per day each way (3h40, factor 0.85, numbering continued)", () => {
    const plans = buildFlightPlans(NOW, 3);
    const oneStop = plans.filter((p) => p.stops === 1);
    expect(oneStop).toHaveLength(6);
    expect(new Set(oneStop.map((p) => p.flightNo))).toEqual(
      new Set(["BN 204", "BN 214"]),
    );
    for (const p of oneStop) {
      expect(p.arriveAt.getTime() - p.departAt.getTime()).toBe(220 * 60_000);
      expect(p.priceFactor).toBe(0.85);
      expect(["BKK-HKT", "HKT-BKK"]).toContain(`${p.origin}-${p.destination}`);
    }
    expect(plans.filter((p) => p.stops === 0).length).toBe(plans.length - 6);
  });

  it("AC-INV-20 When listing airports, should carry IANA timezones", () => {
    const tz = Object.fromEntries(AIRPORTS.map((a) => [a.code, a.timezone]));
    expect(tz).toEqual({
      BKK: "Asia/Bangkok",
      DMK: "Asia/Bangkok",
      CNX: "Asia/Bangkok",
      HKT: "Asia/Bangkok",
      HDY: "Asia/Bangkok",
      SIN: "Asia/Singapore",
      NRT: "Asia/Tokyo",
    });
  });

  it("When picking departures, should keep the price factor within 0.90-1.20", () => {
    for (const hour of [6, 10, 14, 16, 18, 21]) {
      expect(priceFactorForHour(hour)).toBeGreaterThanOrEqual(0.9);
      expect(priceFactorForHour(hour)).toBeLessThanOrEqual(1.2);
    }
  });

  it("When planning BKK→CNX, should seed BN 199 with 1 seat left and BN 101 Value as reprice trigger", () => {
    const plans = buildFlightPlans(NOW, 2);
    expect(
      plans
        .filter((p) => p.flightNo === "BN 199")
        .every((p) => p.seatsLeft === 1),
    ).toBe(true);
    const bn101 = plans.find((p) => p.flightNo === "BN 101");
    expect(
      bn101?.fares.filter((f) => f.repriceTrigger).map((f) => f.family),
    ).toEqual(["VALUE"]);
  });

  it("When planning run date + 9, should sell out every BKK→CNX flight only", () => {
    const plans = buildFlightPlans(NOW, 12);
    const day9 = bangkokMidnight(NOW).getTime() + 9 * 86_400_000;
    const soldOut = plans.filter((p) => p.soldOut);
    expect(soldOut).toHaveLength(4);
    expect(
      soldOut.every((p) => p.origin === "BKK" && p.destination === "CNX"),
    ).toBe(true);
    expect(
      soldOut.every(
        (p) =>
          p.departAt.getTime() >= day9 &&
          p.departAt.getTime() < day9 + 86_400_000,
      ),
    ).toBe(true);
  });
});

describe("AC-INV-11 seat layout and tiers", () => {
  it("When building A320, should have 180 seats with 100/200/300 tiers", () => {
    const seats = buildSeatPlans("A320");
    expect(seats).toHaveLength(30 * 6);
    expect(seats.find((s) => s.row === 2)?.price).toBe(200);
    expect(seats.find((s) => s.row === 4)?.price).toBe(100);
    expect(
      seats.filter((s) => s.kind === "EXIT").every((s) => s.price === 300),
    ).toBe(true);
    expect(AIRCRAFT_LAYOUTS.A320.exitRows).toEqual([12, 13]);
  });

  it("When building A321neo, should have 198 seats with 250/450/600 tiers", () => {
    const seats = buildSeatPlans("A321neo");
    expect(seats).toHaveLength(33 * 6);
    expect(seats.find((s) => s.row === 3)?.price).toBe(450);
    expect(seats.find((s) => s.row === 20)?.price).toBe(250);
    expect(seats.find((s) => s.row === 14)?.price).toBe(600);
  });

  it("When building seats, should classify window, aisle and middle letters", () => {
    const row5 = buildSeatPlans("A320").filter((s) => s.row === 5);
    expect(row5.map((s) => s.kind)).toEqual([
      "WINDOW",
      "MIDDLE",
      "AISLE",
      "AISLE",
      "MIDDLE",
      "WINDOW",
    ]);
  });
});
