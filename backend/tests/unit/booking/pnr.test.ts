import { describe, expect, it } from "vitest";
import { PNR_ALPHABET, generatePnr } from "@/modules/booking/models/pnr.js";

describe("generatePnr", () => {
  it("AC-RH-12: When generating, should draw 6 characters from A-Z and 0-9 with no exclusions", () => {
    expect(PNR_ALPHABET).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(PNR_ALPHABET).toHaveLength(36);
  });

  it("AC-RH-12: When the random source returns indexes, should map each draw uniformly over the alphabet", () => {
    const draws = [0, 25, 26, 35, 1, 10];
    const calls: number[] = [];
    const pnr = generatePnr((max) => {
      calls.push(max);
      return draws[calls.length - 1] ?? 0;
    });

    expect(pnr).toBe("AZ09BK");
    expect(calls).toEqual([36, 36, 36, 36, 36, 36]);
  });
});
