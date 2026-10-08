import type { PrismaClient } from "@/database/generated/client.js";
import type {
  BookingDraftRecord,
  NewBookingDraft,
  OutboundSelection,
} from "../types/bookingDraft.js";

const draftSelect = {
  id: true,
  sessionId: true,
  searchId: true,
  tripType: true,
  adults: true,
  children: true,
  infants: true,
  searchedAt: true,
  outboundFlightId: true,
  outboundFareFamily: true,
  outboundPrice: true,
  outboundArriveAt: true,
  confirmedAt: true,
} as const;

export interface BookingDraftRepository {
  create(draft: NewBookingDraft): Promise<string>;
  findForSession(
    draftId: string,
    sessionId: string,
  ): Promise<BookingDraftRecord | null>;
  saveOutbound(draftId: string, selection: OutboundSelection): Promise<void>;
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
        select: draftSelect,
      });
      return row as BookingDraftRecord | null;
    },
    async saveOutbound(draftId, selection) {
      await prisma.bookingDraft.update({
        where: { id: draftId },
        data: {
          outboundFlightId: selection.flightId,
          outboundFareFamily: selection.fareFamily,
          outboundPrice: selection.price,
          outboundArriveAt: selection.arriveAt,
        },
      });
    },
  };
}
