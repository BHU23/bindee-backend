import type { SearchQuery } from "@/modules/inventory/index.js";

export interface CreateSearchResponse {
  searchId: string;
  expiresAt: string;
}

export interface RecentSearchResponse {
  id: string;
  tripType: SearchQuery["tripType"];
  route: { origin: string; destination: string };
  dates: { depart: string; return?: string };
  pax: { adults: number; children: number; infants: number };
  cabin: SearchQuery["cabin"];
}

export interface PopularRouteResponse {
  origin: string;
  destination: string;
  city: string;
  /** Lowest Lite adult fare incl. taxes over the next 30 days; null when no seats. */
  fromPricePerPax: number | null;
}

export interface PromotionResponse {
  id: string;
  title: string;
  imageUrl: string;
  route: { origin: string; destination: string };
  promoCode: string;
  validUntil: string;
}

export interface RecentSearchRecord {
  id: string;
  payload: SearchQuery;
}

export interface PromotionRecord {
  id: string;
  title: string;
  imageUrl: string;
  originCode: string;
  destinationCode: string;
  promoCode: string;
  validUntil: Date;
}

export interface FlightCardDto {
  flightId: string;
  flightNo: string;
  from: string;
  to: string;
  /** UTC ISO instants; the UI formats them in the airport's timezone. */
  depart: string;
  arrive: string;
  /** Block time in minutes. */
  duration: number;
  stops: number;
  /** Cheapest adult price incl. tax among the fare families passing the filters. */
  fromPricePerPax: number;
  seatsLeft: number;
  lowest: boolean;
}

export interface FlightListResponse {
  query: SearchQuery;
  flights: FlightCardDto[];
  priceRange: { min: number; max: number };
  calendar: {
    date: string;
    lowestFare: number | null;
    seatsLeft: number;
    soldOut: boolean;
  }[];
  searchedAt: string;
  expiresAt: string;
}
