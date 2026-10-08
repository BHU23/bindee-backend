import { describe, expect, it } from "vitest";
import { departureBand } from "@/modules/search/services/departureBands.js";

const BKK = "Asia/Bangkok";
// 2026-10-08 at the given Bangkok local time, as a UTC instant (UTC+7).
function bangkok(time: string): string {
  return new Date(`2026-10-08T${time}:00+07:00`).toISOString();
}

describe("AC-FR-09 departure band boundaries (Asia/Bangkok)", () => {
  it.each([
    ["04:59", "night"],
    ["05:00", "morning"],
    ["11:59", "morning"],
    ["12:00", "afternoon"],
    ["17:59", "afternoon"],
    ["18:00", "evening"],
    ["21:59", "evening"],
    ["22:00", "night"],
    ["00:00", "night"],
  ])("When departing at %s, should be %s", (time, band) => {
    expect(departureBand(bangkok(time), BKK)).toBe(band);
  });
});

describe("AC-FR-02 bands use the departure airport's local time", () => {
  it("When the same instant departs from SIN (UTC+8), should be one hour later than BKK", () => {
    const instant = bangkok("10:30"); // 03:30Z
    expect(departureBand(instant, "Asia/Bangkok")).toBe("morning");
    expect(departureBand(bangkok("17:30"), "Asia/Singapore")).toBe("evening");
    expect(departureBand(bangkok("17:30"), BKK)).toBe("afternoon");
  });

  it("When departing from NRT (UTC+9), should use Tokyo time across midnight", () => {
    // 18:30 Bangkok = 20:30 Tokyo -> evening; 20:00 Bangkok = 22:00 Tokyo -> night.
    expect(departureBand(bangkok("18:30"), "Asia/Tokyo")).toBe("evening");
    expect(departureBand(bangkok("20:00"), "Asia/Tokyo")).toBe("night");
    expect(departureBand(bangkok("20:00"), BKK)).toBe("evening");
  });
});
