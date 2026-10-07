import type { SearchQuery } from "@/modules/inventory/index.js";

/** Identity of a query for recent-search de-duplication. */
export function queryKey(query: SearchQuery): string {
  return [
    query.tripType,
    query.origin,
    query.destination,
    query.departDate,
    query.returnDate ?? "",
    query.adults,
    query.children,
    query.infants,
    query.cabin,
  ].join("|");
}
