import type { FareFamily, RepriceResult } from "@/modules/inventory/index.js";
import type { SelectFareResponse } from "../types/bookingDraft.js";

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
