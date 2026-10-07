export type FareFamily = "LITE" | "VALUE" | "FLEX";
export type TripType = "ONE_WAY" | "ROUND_TRIP";
export type SeatKind = "WINDOW" | "MIDDLE" | "AISLE" | "EXIT";
export type SeatStatus = "AVAILABLE" | "SOLD" | "HELD";

export interface PaxCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface SearchQuery extends PaxCounts {
  tripType: TripType;
  origin: string;
  destination: string;
  /** Local (Bangkok) calendar day, YYYY-MM-DD. */
  departDate: string;
  returnDate?: string;
  cabin: "ECONOMY";
}

export interface FareOption {
  family: FareFamily;
  /** Price per person incl. tax, fuel surcharge and service fee (THB). */
  perAdult: number;
  perChild: number;
  perInfant: number;
  /** Total for the whole party. */
  total: number;
  cabinBagKg: number;
  checkedBagKg: number;
  changeAllowed: boolean;
  changeFee: number;
  refundAllowed: boolean;
  refundFee: number;
  seatIncluded: boolean;
}

export interface FlightOption {
  flightId: string;
  flightNo: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  international: boolean;
  seatsLeft: number;
  soldOut: boolean;
  fares: FareOption[];
}

export interface CalendarDay {
  date: string;
  /** Lowest Lite adult price among flights with seats, or null when sold out. */
  lowestFare: number | null;
  soldOut: boolean;
}

export interface SearchResult {
  searchId: string;
  international: boolean;
  outbound: FlightOption[];
  inbound?: FlightOption[];
  calendar: CalendarDay[];
}

export type RepriceReason = "FARE_SOLD_OUT" | "PRICE_UPDATED";

export interface RepriceResult {
  changed: boolean;
  oldPrice: number;
  newPrice: number;
  perPax: { adult: number; child: number; infant: number };
  reason?: RepriceReason;
}

export interface RepriceInput {
  searchId: string;
  flightId: string;
  fareFamily: FareFamily;
  paxCounts: PaxCounts;
}

export interface SeatInfo {
  row: number;
  letter: string;
  kind: SeatKind;
  price: number;
  status: SeatStatus;
}

export interface SeatMap {
  flightId: string;
  aircraft: string;
  seats: SeatInfo[];
}

export interface HoldSegment {
  flightId: string;
  fareFamily: FareFamily;
  seats?: { paxIndex: number; seatNo: string }[];
}

export interface HoldRequest {
  bookingRef: string;
  segments: HoldSegment[];
  paxCount: number;
  ttlSeconds: number;
}

export interface HoldResult {
  holdId: string;
  expiresAt: Date;
}

export interface RoutePair {
  origin: string;
  destination: string;
}

export interface FromPrice extends RoutePair {
  /** Lowest Lite adult price incl. taxes among days with seats; null when no seats. */
  price: number | null;
}

export interface InventoryPort {
  searchFlights(query: SearchQuery): Promise<SearchResult>;
  reprice(input: RepriceInput): Promise<RepriceResult>;
  getSeatMap(flightId: string): Promise<SeatMap>;
  holdSeats(input: HoldRequest): Promise<HoldResult>;
  releaseSeats(holdId: string): Promise<void>;
  extendOrRehold(holdId: string): Promise<HoldResult>;
  findAlternatives(input: {
    flightId: string;
    paxCount: number;
    dayWindow: number;
  }): Promise<FlightOption[]>;
  getFromPrices(input: {
    routes: RoutePair[];
    days: number;
  }): Promise<FromPrice[]>;
}
