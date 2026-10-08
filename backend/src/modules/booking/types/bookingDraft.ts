import type { FareFamily, TripType } from "@/modules/inventory/index.js";

export interface BookingDraftRecord {
  id: string;
  sessionId: string;
  searchId: string;
  tripType: TripType;
  adults: number;
  children: number;
  infants: number;
  searchedAt: Date;
  outboundFlightId: string | null;
  outboundFareFamily: FareFamily | null;
  outboundPrice: number | null;
  outboundArriveAt: Date | null;
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

export interface OutboundSelection {
  flightId: string;
  fareFamily: FareFamily;
  price: number;
  arriveAt: Date;
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
