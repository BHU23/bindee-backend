import { describe, expect, it } from "vitest";
import { createSearchSchema } from "@/modules/search/validators/createSearch.js";

const TODAY = "2026-10-07";
const schema = createSearchSchema(TODAY);

function body(overrides: Record<string, unknown> = {}) {
  return {
    tripType: "ONE_WAY",
    origin: "BKK",
    destination: "CNX",
    departDate: "2026-10-08",
    adults: 1,
    ...overrides,
  };
}

function failedFields(input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("createSearchSchema", () => {
  describe("defaults", () => {
    it("When children, infants and cabin are missing, should default to 0, 0 and ECONOMY", () => {
      expect(schema.parse(body())).toMatchObject({
        children: 0,
        infants: 0,
        cabin: "ECONOMY",
      });
    });

    it("When the IATA codes are lower case, should upper-case them", () => {
      expect(schema.parse(body({ origin: "bkk" }))).toMatchObject({
        origin: "BKK",
      });
    });
  });

  describe("AC-HS-01 depart date window", () => {
    it("When departDate is today, should accept it", () => {
      expect(failedFields(body({ departDate: TODAY }))).toEqual([]);
    });

    it("When departDate is in the past, should fail on departDate", () => {
      expect(failedFields(body({ departDate: "2026-10-06" }))).toEqual([
        "departDate",
      ]);
    });

    it("When departDate is 330 days ahead, should accept it", () => {
      expect(failedFields(body({ departDate: "2027-09-02" }))).toEqual([]);
    });

    it("When departDate is 331 days ahead, should fail on departDate", () => {
      expect(failedFields(body({ departDate: "2027-09-03" }))).toEqual([
        "departDate",
      ]);
    });

    it("When departDate is not a real calendar day, should fail on departDate", () => {
      expect(failedFields(body({ departDate: "2026-02-30" }))).toEqual([
        "departDate",
      ]);
    });
  });

  describe("AC-HS-02 return date", () => {
    it("When a round trip returns before departing, should fail on returnDate", () => {
      expect(
        failedFields(
          body({
            tripType: "ROUND_TRIP",
            departDate: "2026-10-10",
            returnDate: "2026-10-09",
          }),
        ),
      ).toEqual(["returnDate"]);
    });

    it("When a round trip returns the same day, should accept it", () => {
      expect(
        failedFields(
          body({
            tripType: "ROUND_TRIP",
            departDate: "2026-10-10",
            returnDate: "2026-10-10",
          }),
        ),
      ).toEqual([]);
    });

    it("When a round trip has no returnDate, should fail on returnDate", () => {
      expect(failedFields(body({ tripType: "ROUND_TRIP" }))).toEqual([
        "returnDate",
      ]);
    });

    it("When a one-way trip sends a returnDate, should drop it", () => {
      expect(
        schema.parse(body({ returnDate: "2026-10-12" })).returnDate,
      ).toBeUndefined();
    });
  });

  describe("AC-HS-03 airports", () => {
    it("When origin equals destination, should fail on destination", () => {
      expect(failedFields(body({ destination: "BKK" }))).toEqual([
        "destination",
      ]);
    });

    it("When a code is not a 3-letter IATA code, should fail on that field", () => {
      expect(failedFields(body({ origin: "B1K" }))).toEqual(["origin"]);
      expect(failedFields(body({ destination: "CNXX" }))).toEqual([
        "destination",
      ]);
    });
  });

  describe("AC-HS-04 passengers", () => {
    it("When adults is 0, should fail on adults", () => {
      expect(failedFields(body({ adults: 0 }))).toEqual(["adults"]);
    });

    it("When adults + children is more than 9, should fail on children", () => {
      expect(failedFields(body({ adults: 5, children: 5 }))).toEqual([
        "children",
      ]);
    });

    it("When adults + children is exactly 9, should accept it", () => {
      expect(failedFields(body({ adults: 5, children: 4 }))).toEqual([]);
    });

    it("When infants is more than adults, should fail on infants", () => {
      expect(failedFields(body({ adults: 1, infants: 2 }))).toEqual([
        "infants",
      ]);
    });

    it("When counts are not integers, should fail on that field", () => {
      expect(failedFields(body({ adults: 1.5 }))).toEqual(["adults"]);
    });
  });
});
