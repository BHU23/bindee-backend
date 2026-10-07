import { NotFoundError } from "@/core/errors/index.js";
import type { PrismaClient } from "@/database/generated/client.js";
import type {
  SeatMap,
  SeatStatus,
} from "@/modules/inventory/types/inventory.js";
import { liveHold } from "./holds.js";

export async function getSeatMap(
  prisma: PrismaClient,
  now: Date,
  flightId: string,
): Promise<SeatMap> {
  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    include: {
      seats: {
        orderBy: [{ row: "asc" }, { letter: "asc" }],
        include: {
          holdItems: { where: { hold: liveHold(now) }, select: { id: true } },
        },
      },
    },
  });
  if (!flight) throw new NotFoundError("NOT_FOUND", "Flight not found");
  return {
    flightId: flight.id,
    aircraft: flight.aircraft,
    seats: flight.seats.map((seat) => ({
      row: seat.row,
      letter: seat.letter,
      kind: seat.kind,
      price: seat.price,
      status:
        seat.status === "SOLD"
          ? "SOLD"
          : ((seat.holdItems.length > 0
              ? "HELD"
              : "AVAILABLE") satisfies SeatStatus),
    })),
  };
}
