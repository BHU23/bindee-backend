import type { FareFamily, FlightOption } from "@/modules/inventory/index.js";
import { departureBand, type DepartureBand } from "./departureBands.js";

export type FlightSort = "price" | "departure" | "duration";

export interface FlightFilters {
  directOnly?: boolean;
  departure?: DepartureBand[];
  minPrice?: number;
  maxPrice?: number;
  fare?: FareFamily[];
  sort: FlightSort;
}

export interface FilteredFlight {
  flight: FlightOption;
  /** Cheapest adult price incl. tax among the fare families that pass the filters. */
  fromPricePerPax: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

function passingPrices(flight: FlightOption, filters: FlightFilters) {
  return flight.fares
    .filter((f) => !filters.fare || filters.fare.includes(f.family))
    .map((f) => f.perAdult)
    .filter(
      (price) =>
        (filters.minPrice === undefined || price >= filters.minPrice) &&
        (filters.maxPrice === undefined || price <= filters.maxPrice),
    );
}

function byDeparture(a: FlightOption, b: FlightOption): number {
  return (
    Date.parse(a.departAt) - Date.parse(b.departAt) ||
    a.flightNo.localeCompare(b.flightNo)
  );
}

const SORT_KEY: Record<FlightSort, (item: FilteredFlight) => number> = {
  price: (item) => item.fromPricePerPax,
  departure: (item) => Date.parse(item.flight.departAt),
  duration: (item) => item.flight.durationMinutes,
};

export function applyFlightFilters(
  flights: FlightOption[],
  filters: FlightFilters,
): FilteredFlight[] {
  const kept: FilteredFlight[] = [];
  for (const flight of flights) {
    if (filters.directOnly && flight.stops !== 0) continue;
    if (
      filters.departure &&
      !filters.departure.includes(
        departureBand(flight.departAt, flight.departTimezone),
      )
    ) {
      continue;
    }
    const prices = passingPrices(flight, filters);
    if (prices.length === 0) continue;
    kept.push({ flight, fromPricePerPax: Math.min(...prices) });
  }
  const key = SORT_KEY[filters.sort];
  return kept.sort(
    (a, b) => key(a) - key(b) || byDeparture(a.flight, b.flight),
  );
}

/** Min and max price per person over every fare family of the unfiltered flights. */
export function priceRangeOf(flights: FlightOption[]): PriceRange {
  const prices = flights.flatMap((f) => f.fares.map((fare) => fare.perAdult));
  if (prices.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** The one flight carrying the `lowest` badge: cheapest bookable flight, earliest on a tie. */
export function findLowestFlightId(
  flights: FlightOption[],
): string | undefined {
  const candidates = flights
    .filter((f) => !f.soldOut && f.fares.length > 0)
    .map((flight) => ({
      flight,
      price: Math.min(...flight.fares.map((fare) => fare.perAdult)),
    }))
    .sort((a, b) => a.price - b.price || byDeparture(a.flight, b.flight));
  return candidates[0]?.flight.flightId;
}
