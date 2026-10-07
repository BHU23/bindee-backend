import { describe, expect, it } from "vitest";
import { queryKey } from "@/modules/search/services/queryKey.js";
import type { SearchQuery } from "@/modules/inventory/index.js";

const base: SearchQuery = {
  tripType: "ONE_WAY",
  origin: "BKK",
  destination: "CNX",
  departDate: "2026-10-08",
  adults: 1,
  children: 0,
  infants: 0,
  cabin: "ECONOMY",
};

describe("queryKey", () => {
  it("When two queries are identical, should produce the same key", () => {
    expect(queryKey({ ...base })).toBe(queryKey({ ...base }));
  });

  it.each([
    ["tripType", { tripType: "ROUND_TRIP", returnDate: "2026-10-09" }],
    ["origin", { origin: "DMK" }],
    ["destination", { destination: "HKT" }],
    ["departDate", { departDate: "2026-10-09" }],
    ["adults", { adults: 2 }],
    ["children", { children: 1 }],
    ["infants", { infants: 1 }],
  ] as const)("When %s differs, should produce a different key", (_, patch) => {
    expect(queryKey({ ...base, ...patch })).not.toBe(queryKey(base));
  });

  it("When returnDate differs on a round trip, should produce a different key", () => {
    const round: SearchQuery = {
      ...base,
      tripType: "ROUND_TRIP",
      returnDate: "2026-10-09",
    };
    expect(queryKey({ ...round, returnDate: "2026-10-10" })).not.toBe(
      queryKey(round),
    );
  });
});
