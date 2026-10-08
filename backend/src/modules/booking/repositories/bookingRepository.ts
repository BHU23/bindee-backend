import type { PrismaClient } from "@/database/generated/client.js";
import type { CreateBookingResult, NewBooking } from "../types/booking.js";

export interface BookingRepository {
  /** Inserts the booking and marks its draft confirmed in one transaction. */
  create(booking: NewBooking): Promise<CreateBookingResult>;
}

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNIQUE_VIOLATION
  );
}

export function createBookingRepository(
  prisma: PrismaClient,
): BookingRepository {
  return {
    async create(booking) {
      try {
        await prisma.$transaction([
          prisma.booking.create({ data: booking }),
          prisma.bookingDraft.update({
            where: { id: booking.draftId },
            data: { confirmedAt: booking.createdAt },
          }),
        ]);
        return { kind: "created" };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Two unique keys can fail: the draft already has a booking, or the PNR is taken.
        const existing = await prisma.booking.findUnique({
          where: { draftId: booking.draftId },
          select: { id: true },
        });
        return { kind: existing ? "draft_taken" : "pnr_taken" };
      }
    },
  };
}
