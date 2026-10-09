import type {
  FareFamily,
  FlightOption,
  RepriceResult,
} from "@/modules/inventory/index.js";
import type {
  FaresResponse,
  FlightSummaryDto,
  SelectFareResponse,
} from "../types/bookingDraft.js";

export function selectFareView(
  flightId: string,
  fareFamily: FareFamily,
  repriced: RepriceResult,
): SelectFareResponse {
  return {
    selection: { flightId, fareFamily },
    price: { total: repriced.newPrice, perPax: repriced.perPax },
  };
}

export function faresView(flight: FlightOption): FaresResponse {
  return {
    flightId: flight.flightId,
    fares: flight.fares.map((fare) => ({
      family: fare.family,
      perAdult: fare.perAdult,
      perChild: fare.perChild,
      perInfant: fare.perInfant,
      total: fare.total,
      cabinBagKg: fare.cabinBagKg,
      checkedBagKg: fare.checkedBagKg,
      changeAllowed: fare.changeAllowed,
      changeFee: fare.changeFee,
      refundAllowed: fare.refundAllowed,
      refundFee: fare.refundFee,
      seatIncluded: fare.seatIncluded,
    })),
  };
}

/** Same shape as the flight-results card, so the client renders both with one component. */
export function flightSummaryView(flight: FlightOption): FlightSummaryDto {
  return {
    flightId: flight.flightId,
    flightNo: flight.flightNo,
    from: flight.origin,
    to: flight.destination,
    depart: flight.departAt,
    arrive: flight.arriveAt,
    duration: flight.durationMinutes,
    stops: flight.stops,
    fromPricePerPax: Math.min(...flight.fares.map((f) => f.perAdult)),
    seatsLeft: flight.seatsLeft,
    lowest: false,
  };
}
