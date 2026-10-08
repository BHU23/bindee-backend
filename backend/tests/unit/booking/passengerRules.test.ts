import { describe, expect, it } from "vitest";
import {
  ageOn,
  isTitleAllowed,
  titleGender,
  typeForAge,
} from "@/modules/booking/models/passengerRules.js";

describe("ageOn", () => {
  it("When the birthday is the travel date, should count the new year", () => {
    expect(ageOn("2014-10-08", "2026-10-08")).toBe(12);
  });
  it("When the birthday is the day after the travel date, should not count it yet", () => {
    expect(ageOn("2014-10-09", "2026-10-08")).toBe(11);
  });
  it("When born on 29 Feb, should count the year from 1 Mar in common years", () => {
    expect(ageOn("2020-02-29", "2026-02-28")).toBe(5);
    expect(ageOn("2020-02-29", "2026-03-01")).toBe(6);
  });
  it("When born after the travel date, should return a negative age", () => {
    expect(ageOn("2026-10-09", "2026-10-08")).toBeLessThan(0);
  });
});

describe("typeForAge", () => {
  it.each([
    [0, "infant"],
    [1, "infant"],
    [2, "child"],
    [11, "child"],
    [12, "adult"],
    [80, "adult"],
  ] as const)("AC-PX-02: When age is %i, should be %s", (age, type) => {
    expect(typeForAge(age)).toBe(type);
  });
  it("When age is negative, should be null", () => {
    expect(typeForAge(-1)).toBeNull();
  });
});

describe("title rules", () => {
  it.each([
    ["adult", "Mr", "M"],
    ["adult", "Mrs", "F"],
    ["adult", "Ms", "F"],
    ["adult", "Miss", "F"],
    ["child", "Mstr", "M"],
    ["child", "Miss", "F"],
    ["infant", "Mstr", "M"],
    ["infant", "Miss", "F"],
  ] as const)(
    "When %s uses %s, should allow it with gender %s",
    (type, title, gender) => {
      expect(isTitleAllowed(type, title)).toBe(true);
      expect(titleGender(title)).toBe(gender);
    },
  );
  it.each([
    ["adult", "Mstr"],
    ["child", "Mr"],
    ["child", "Mrs"],
    ["infant", "Mrs"],
    ["infant", "Ms"],
  ] as const)(
    "AC-PX-09: When %s uses %s, should not allow it",
    (type, title) => {
      expect(isTitleAllowed(type, title)).toBe(false);
    },
  );
});
