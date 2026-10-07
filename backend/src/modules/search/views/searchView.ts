import type { FromPrice } from "@/modules/inventory/index.js";
import type {
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
