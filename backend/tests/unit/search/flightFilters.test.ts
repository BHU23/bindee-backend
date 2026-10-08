import { describe, expect, it } from "vitest";
import type {
  FareFamily,
  FareOption,
  FlightOption,
} from "@/modules/inventory/index.js";
import {
  applyFlightFilters,
  findLowestFlightId,
  priceRangeOf,
  type FlightFilters,
} from "@/modules/search/services/flightFilters.js";

function fare(family: FareFamily, perAdult: number): FareOption {
  return {
    family,
    perAdult,
    perChild: perAdult,
    perInfant: 0,
    total: perAdult,
    cabinBagKg: 7,
    checkedBagKg: 0,
    changeAllowed: false,
    changeFee: 0,
    refundAllowed: false,
    refundFee: 0,
    seatIncluded: false,
  };
}

function flight(
  id: string,
  localTime: string,
  prices: [number, number, number],
  extra: Partial<FlightOption> = {},
): FlightOption {
  return {
    flightId: id,
    flightNo: id,
    origin: "BKK",
    destination: "HKT",
    departAt: new Date(`2026-10-08T${localTime}:00+07:00`).toISOString(),
    arriveAt: new Date(`2026-10-08T${localTime}:00+07:00`).toISOString(),
    durationMinutes: 85,
    stops: 0,
    departTimezone: "Asia/Bangkok",
    international: false,
    seatsLeft: 10,
    soldOut: false,
    fares: [
      fare("LITE", prices[0]),
      fare("VALUE", prices[1]),
      fare("FLEX", prices[2]),
    ],
    ...extra,
  };
}

const F1 = flight("F1", "07:00", [1000, 1500, 2000]);
const F2 = flight("F2", "12:00", [900, 1400, 1900], { durationMinutes: 60 });
const F3 = flight("F3", "19:00", [1200, 1700, 2200], {
  stops: 1,
  durationMinutes: 220,
});
const F4 = flight("F4", "23:00", [900, 1300, 1800], { durationMinutes: 85 });
const ALL = [F1, F2, F3, F4];
const NONE: FlightFilters = { sort: "departure" };

function ids(filters: Partial<FlightFilters>, flights = ALL): string[] {
  return applyFlightFilters(flights, { ...NONE, ...filters }).map(
    (r) => r.flight.flightId,
  );
}

describe("AC-FR-01 directOnly", () => {
  it("When directOnly is true, should keep 0-stop flights only", () => {
    expect(ids({ directOnly: true })).toEqual(["F1", "F2", "F4"]);
  });
  it("AC-FR-15 When directOnly is not set, should keep both", () => {
    expect(ids({})).toEqual(["F1", "F2", "F3", "F4"]);
    expect(ids({ directOnly: false })).toEqual(["F1", "F2", "F3", "F4"]);
  });
});

describe("AC-FR-02 departure bands", () => {
  it("When bands are given, should keep flights in any of them", () => {
    expect(ids({ departure: ["morning", "evening"] })).toEqual(["F1", "F3"]);
    expect(ids({ departure: ["night"] })).toEqual(["F4"]);
  });
});

describe("AC-FR-03 price and fare family", () => {
  it("When min/max price is given, should keep flights with a family inside the range and price from that family", () => {
    const result = applyFlightFilters(ALL, {
      ...NONE,
      minPrice: 1450,
      maxPrice: 1750,
    });
    expect(result.map((r) => [r.flight.flightId, r.fromPricePerPax])).toEqual([
      ["F1", 1500],
      ["F3", 1700],
    ]);
  });

  it("When a fare family is given, should keep flights with that family and price from it", () => {
    const result = applyFlightFilters(ALL, { ...NONE, fare: ["FLEX"] });
    expect(result.map((r) => r.fromPricePerPax)).toEqual([
      2000, 1900, 2200, 1800,
    ]);
  });

  it("When fare and price are combined, should require one family satisfying both", () => {
    // LITE is in range for F2 (900) but only VALUE/FLEX are requested.
    const result = applyFlightFilters(ALL, {
      ...NONE,
      fare: ["VALUE", "FLEX"],
      maxPrice: 1400,
    });
    expect(result.map((r) => [r.flight.flightId, r.fromPricePerPax])).toEqual([
      ["F2", 1400],
      ["F4", 1300],
    ]);
  });

  it("When every filter is combined, should satisfy all", () => {
    expect(
      ids({
        directOnly: true,
        departure: ["afternoon", "night"],
        fare: ["LITE"],
        maxPrice: 900,
      }),
    ).toEqual(["F2", "F4"]);
  });

  it("When nothing matches, should return an empty list", () => {
    expect(ids({ maxPrice: 100 })).toEqual([]);
  });

  it("When no fare filter is set, should use the cheapest family", () => {
    const result = applyFlightFilters(ALL, NONE);
    expect(result.map((r) => r.fromPricePerPax)).toEqual([
      1000, 900, 1200, 900,
    ]);
  });
});

describe("AC-FR-04 sort", () => {
  it("When sort=price, should be ascending with ties broken by departure", () => {
    expect(ids({ sort: "price" })).toEqual(["F2", "F4", "F1", "F3"]);
  });

  it("When sort=departure, should be ascending by departure", () => {
    expect(ids({ sort: "departure" }, [F4, F3, F2, F1])).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
    ]);
  });

  it("When sort=duration, should be ascending with ties broken by departure", () => {
    expect(ids({ sort: "duration" })).toEqual(["F2", "F1", "F4", "F3"]);
  });

  it("When everything ties, should keep departure order whatever the input order", () => {
    const a = flight("A", "09:00", [1, 1, 1]);
    const b = flight("B", "09:00", [1, 1, 1]);
    expect(ids({ sort: "price" }, [b, a])).toEqual(["A", "B"]);
  });
});

describe("AC-FR-08 priceRange and lowest on the unfiltered set", () => {
  it("When flights exist, should return min and max across all families", () => {
    expect(priceRangeOf(ALL)).toEqual({ min: 900, max: 2200 });
  });

  it("When there are no flights, should return 0/0", () => {
    expect(priceRangeOf([])).toEqual({ min: 0, max: 0 });
  });

  it("When several flights share the lowest price, should pick the earliest departure", () => {
    expect(findLowestFlightId(ALL)).toBe("F2");
  });

  it("When the cheapest flight is sold out, should skip it", () => {
    const sold = flight("S", "06:00", [100, 200, 300], { soldOut: true });
    expect(findLowestFlightId([sold, ...ALL])).toBe("F2");
    expect(findLowestFlightId([sold])).toBeUndefined();
    expect(findLowestFlightId([])).toBeUndefined();
  });
});
