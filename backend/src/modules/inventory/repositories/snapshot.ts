import type {
  CalendarDay,
  FlightOption,
  SearchQuery,
} from "@/modules/inventory/types/inventory.js";

export const SNAPSHOT_TTL_MS = 20 * 60 * 1000;

export interface SnapshotPrices {
  [flightId: string]: {
    [family: string]: { perAdult: number; perInfant: number };
  };
}

export interface SnapshotData {
  pax: { adults: number; children: number; infants: number };
  prices: SnapshotPrices;
  /** Results shown to the guest, so a later read returns exactly what was quoted. */
  results: {
    outbound: FlightOption[];
    inbound?: FlightOption[];
    calendar: CalendarDay[];
  };
  query: SearchQuery;
  /** Guest session that created the search; null when none was sent. */
  sessionId: string | null;
}
