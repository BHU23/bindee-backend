import { describe, expect, it } from "vitest";
import {
  adultPrice,
  infantPrice,
  priceParty,
  type FarePricing,
} from "@/modules/inventory/services/pricing.js";

const CNX_LITE: FarePricing = {
  basePrice: 690,
  airportTax: 100,
  fuelSurcharge: 150,
  serviceFee: 50,
};

describe("AC-INV-16 pricing", () => {
  it("When factor is 1.0, should price BKK→CNX Lite at 990 per adult", () => {
    expect(adultPrice(CNX_LITE, 1.0)).toBe(990);
  });

  it("When pricing an infant, should charge 10% of base plus airport tax only", () => {
    expect(infantPrice(CNX_LITE, 1.0)).toBe(69 + 100);
  });

  it("When the factor is 1.2, should scale only the base fare", () => {
    expect(adultPrice(CNX_LITE, 1.2)).toBe(828 + 300);
  });

  it("When pricing a party, should charge children as adults and sum the total", () => {
    const party = priceParty(CNX_LITE, 1.0, {
      adults: 2,
      children: 1,
      infants: 1,
    });
    expect(party.perChild).toBe(party.perAdult);
    expect(party.total).toBe(990 * 3 + 169);
    expect(party.baseFareTotal).toBe(690 * 3);
  });
});
