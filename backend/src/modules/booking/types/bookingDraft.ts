import type { FareFamily, TripType } from "@/modules/inventory/index.js";

export type BookingLeg = "outbound" | "return";

export interface PendingSelection {
  flightId: string;
  fareFamily: FareFamily;
}

export interface LegState {
  flightId: string | null;
  fareFamily: FareFamily | null;
  price: number | null;
  pending: PendingSelection | null;
}

export interface BookingDraftRecord {
  id: string;
  sessionId: string;
  searchId: string;
  tripType: TripType;
  adults: number;
  children: number;
  infants: number;
  searchedAt: Date;
  outbound: LegState;
  outboundArriveAt: Date | null;
  return: LegState;
  confirmedAt: Date | null;
}

export interface NewBookingDraft {
  sessionId: string;
  searchId: string;
  tripType: TripType;
  adults: number;
  children: number;
  infants: number;
  searchedAt: Date;
  createdAt: Date;
}

export interface LegSelection {
  flightId: string;
  fareFamily: FareFamily;
  price: number;
  /** Outbound only: the return list is filtered against it. */
  arriveAt?: Date;
}

export interface CreateDraftResponse {
  draftId: string;
}

export interface SelectFareResponse {
  selection: { flightId: string; fareFamily: FareFamily };
  price: {
    total: number;
    perPax: { adult: number; child: number; infant: number };
  };
}

export interface FareDetailDto {
  family: FareFamily;
  perAdult: number;
  perChild: number;
  perInfant: number;
  total: number;
  cabinBagKg: number;
  checkedBagKg: number;
  changeAllowed: boolean;
  changeFee: number;
  refundAllowed: boolean;
  refundFee: number;
  seatIncluded: boolean;
}

export interface FaresResponse {
  flightId: string;
  fares: FareDetailDto[];
}

export interface FlightSummaryDto {
  flightId: string;
  flightNo: string;
  from: string;
  to: string;
  depart: string;
  arrive: string;
  duration: number;
  stops: number;
  fromPricePerPax: number;
  seatsLeft: number;
  lowest: boolean;
}
