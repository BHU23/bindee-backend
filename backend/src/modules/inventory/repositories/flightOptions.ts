import type { Prisma } from "@/database/generated/client.js";
import { priceParty } from "@/modules/inventory/services/pricing.js";
import type {
  FareOption,
  FlightOption,
  PaxCounts,
} from "@/modules/inventory/types/inventory.js";

export type FlightWithFares = Prisma.FlightGetPayload<{
  include: { route: true; fares: true };
}>;

/** Seats a party occupies; infants travel on a lap. */
export function seatsNeeded(pax: PaxCounts): number {
  return Math.max(1, pax.adults + pax.children);
}

const FAMILY_ORDER = ["LITE", "VALUE", "FLEX"];

export function toFlightOption(
  flight: FlightWithFares,
  seatsLeft: number,
  pax: PaxCounts,
): FlightOption {
  const factor = flight.priceFactor.toNumber();
  const fares: FareOption[] = [...flight.fares]
    .sort(
      (a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family),
    )
    .map((fare) => {
      const party = priceParty(fare, factor, pax);
      return {
        family: fare.family,
        perAdult: party.perAdult,
        perChild: party.perChild,
        perInfant: party.perInfant,
        total: party.total,
        cabinBagKg: fare.cabinBagKg,
        checkedBagKg: fare.checkedBagKg,
        changeAllowed: fare.changeAllowed,
        changeFee: fare.changeFee,
        refundAllowed: fare.refundAllowed,
        refundFee: fare.refundFee,
        seatIncluded: fare.seatIncluded,
      };
    });
  return {
    flightId: flight.id,
    flightNo: flight.flightNo,
    origin: flight.route.originCode,
    destination: flight.route.destinationCode,
    departAt: flight.departAt.toISOString(),
    arriveAt: flight.arriveAt.toISOString(),
    durationMinutes: flight.route.durationMinutes,
    international: flight.route.international,
    seatsLeft,
    soldOut: seatsLeft < seatsNeeded(pax),
    fares,
  };
}

export function liteAdultPrice(flight: FlightWithFares): number | null {
  const lite = flight.fares.find((f) => f.family === "LITE");
  return lite
    ? priceParty(lite, flight.priceFactor.toNumber(), {
        adults: 1,
        children: 0,
        infants: 0,
      }).perAdult
    : null;
}
