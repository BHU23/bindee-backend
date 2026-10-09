import type { PrismaClient } from "@/database/generated/client.js";
import type {
  BookingDraftRecord,
  BookingLeg,
  LegSelection,
  NewBookingDraft,
  PendingSelection,
} from "../types/bookingDraft.js";

export interface BookingDraftRepository {
  create(draft: NewBookingDraft): Promise<string>;
  findForSession(
    draftId: string,
    sessionId: string,
  ): Promise<BookingDraftRecord | null>;
  /** Saves the leg and clears its pending selection. */
  saveSelection(
    draftId: string,
    leg: BookingLeg,
    selection: LegSelection,
  ): Promise<void>;
  /** Remembers what the guest tried to pick while a price change awaits their decision. */
  savePending(
    draftId: string,
    leg: BookingLeg,
    pending: PendingSelection,
  ): Promise<void>;
}

export function createBookingDraftRepository(
  prisma: PrismaClient,
): BookingDraftRepository {
  return {
    async create(draft) {
      const row = await prisma.bookingDraft.create({
        data: draft,
        select: { id: true },
      });
      return row.id;
    },
    async findForSession(draftId, sessionId) {
      const row = await prisma.bookingDraft.findFirst({
        where: { id: draftId, sessionId },
      });
      if (!row) return null;
      return {
        id: row.id,
        sessionId: row.sessionId,
        searchId: row.searchId,
        tripType: row.tripType as BookingDraftRecord["tripType"],
        adults: row.adults,
        children: row.children,
        infants: row.infants,
        searchedAt: row.searchedAt,
        outbound: {
          flightId: row.outboundFlightId,
          fareFamily: row.outboundFareFamily,
          price: row.outboundPrice,
          pending:
            row.outboundPendingFlightId && row.outboundPendingFareFamily
              ? {
                  flightId: row.outboundPendingFlightId,
                  fareFamily: row.outboundPendingFareFamily,
                }
              : null,
        },
        outboundArriveAt: row.outboundArriveAt,
        return: {
          flightId: row.returnFlightId,
          fareFamily: row.returnFareFamily,
          price: row.returnPrice,
          pending:
            row.returnPendingFlightId && row.returnPendingFareFamily
              ? {
                  flightId: row.returnPendingFlightId,
                  fareFamily: row.returnPendingFareFamily,
                }
              : null,
        },
        confirmedAt: row.confirmedAt,
      };
    },
    async saveSelection(draftId, leg, selection) {
      const data =
        leg === "outbound"
          ? {
              outboundFlightId: selection.flightId,
              outboundFareFamily: selection.fareFamily,
              outboundPrice: selection.price,
              outboundArriveAt: selection.arriveAt ?? null,
              outboundPendingFlightId: null,
              outboundPendingFareFamily: null,
              // A new outbound invalidates the return choice (AC-FS-10).
              returnFlightId: null,
              returnFareFamily: null,
              returnPrice: null,
              returnPendingFlightId: null,
              returnPendingFareFamily: null,
            }
          : {
              returnFlightId: selection.flightId,
              returnFareFamily: selection.fareFamily,
              returnPrice: selection.price,
              returnPendingFlightId: null,
              returnPendingFareFamily: null,
            };
      await prisma.bookingDraft.update({ where: { id: draftId }, data });
    },
    async savePending(draftId, leg, pending) {
      const data =
        leg === "outbound"
          ? {
              outboundPendingFlightId: pending.flightId,
              outboundPendingFareFamily: pending.fareFamily,
            }
          : {
              returnPendingFlightId: pending.flightId,
              returnPendingFareFamily: pending.fareFamily,
            };
      await prisma.bookingDraft.update({ where: { id: draftId }, data });
    },
  };
}
