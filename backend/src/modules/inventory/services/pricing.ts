import type { PaxCounts } from "../types/inventory.js";

export const INFANT_BASE_RATIO = 0.1;

export interface FarePricing {
  basePrice: number;
  airportTax: number;
  fuelSurcharge: number;
  serviceFee: number;
}

export interface PartyPrice {
  perAdult: number;
  perChild: number;
  perInfant: number;
  total: number;
  /** Adult + child base fare of the party; the base promo discounts apply to. */
  baseFareTotal: number;
}

/** Base fare after the flight's price factor, rounded to whole baht. */
export function adjustedBase(fare: FarePricing, priceFactor: number): number {
  return Math.round(fare.basePrice * priceFactor);
}

export function adultPrice(fare: FarePricing, priceFactor: number): number {
  return (
    adjustedBase(fare, priceFactor) +
    fare.airportTax +
    fare.fuelSurcharge +
    fare.serviceFee
  );
}

/** Infant pays 10% of the adult base fare plus airport tax only. */
export function infantPrice(fare: FarePricing, priceFactor: number): number {
  return (
    Math.round(adjustedBase(fare, priceFactor) * INFANT_BASE_RATIO) +
    fare.airportTax
  );
}

export function priceParty(
  fare: FarePricing,
  priceFactor: number,
  pax: PaxCounts,
): PartyPrice {
  const perAdult = adultPrice(fare, priceFactor);
  const perInfant = infantPrice(fare, priceFactor);
  return {
    perAdult,
    perChild: perAdult,
    perInfant,
    total: perAdult * (pax.adults + pax.children) + perInfant * pax.infants,
    baseFareTotal:
      adjustedBase(fare, priceFactor) * (pax.adults + pax.children),
  };
}
