import type {
  FlightOption,
  FromPrice,
  StoredSearch,
} from "@/modules/inventory/index.js";
import type {
  FlightCardDto,
  FlightListResponse,
  PopularRouteResponse,
  PromotionRecord,
  PromotionResponse,
  RecentSearchRecord,
  RecentSearchResponse,
} from "../types/search.js";

export function recentSearchView(
  record: RecentSearchRecord,
): RecentSearchResponse {
  const { payload } = record;
  return {
    id: record.id,
    tripType: payload.tripType,
    route: { origin: payload.origin, destination: payload.destination },
    dates: {
      depart: payload.departDate,
      ...(payload.returnDate ? { return: payload.returnDate } : {}),
    },
    pax: {
      adults: payload.adults,
      children: payload.children,
      infants: payload.infants,
    },
    cabin: payload.cabin,
  };
}

export function popularRouteView(
  price: FromPrice,
  city: string,
): PopularRouteResponse {
  return {
    origin: price.origin,
    destination: price.destination,
    city,
    fromPricePerPax: price.price,
  };
}

export function promotionView(record: PromotionRecord): PromotionResponse {
  return {
    id: record.id,
    title: record.title,
    imageUrl: record.imageUrl,
    route: { origin: record.originCode, destination: record.destinationCode },
    promoCode: record.promoCode,
    validUntil: record.validUntil.toISOString(),
  };
}

export function flightCardView(
  flight: FlightOption,
  fromPricePerPax: number,
  lowest: boolean,
): FlightCardDto {
  return {
    flightId: flight.flightId,
    flightNo: flight.flightNo,
    from: flight.origin,
    to: flight.destination,
    depart: flight.departAt,
    arrive: flight.arriveAt,
    duration: flight.durationMinutes,
    stops: flight.stops,
    fromPricePerPax,
    seatsLeft: flight.seatsLeft,
    lowest,
  };
}

export function flightListView(
  stored: StoredSearch,
  flights: FlightCardDto[],
  priceRange: FlightListResponse["priceRange"],
): FlightListResponse {
  return {
    query: stored.query,
    flights,
    priceRange,
    calendar: stored.calendar.map((day) => ({
      date: day.date,
      lowestFare: day.lowestFare,
      seatsLeft: day.seatsLeft,
      soldOut: day.soldOut,
    })),
    searchedAt: stored.searchedAt,
    expiresAt: stored.expiresAt,
  };
}
