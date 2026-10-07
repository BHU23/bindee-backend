import type { PrismaClient } from "../../../database/generated/client.js";

interface AvailabilityRow {
  flight_id: string;
  available: bigint;
}

/**
 * Seats still bookable per flight: status AVAILABLE and not covered by a live hold
 * (a hold is live while it is not released and not expired). Flights with none are absent.
 */
export async function countAvailableSeats(
  prisma: PrismaClient,
  flightIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (flightIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<AvailabilityRow[]>`
    SELECT s.flight_id, COUNT(*) AS available
    FROM seat s
    WHERE s.flight_id = ANY(${flightIds}::text[])
      AND s.status = 'AVAILABLE'
      AND NOT EXISTS (
        SELECT 1
        FROM seat_hold_item i
        JOIN seat_hold h ON h.id = i.hold_id
        WHERE i.seat_id = s.id AND h.released_at IS NULL AND h.expires_at > ${now}
      )
    GROUP BY s.flight_id`;
  return new Map(rows.map((r) => [r.flight_id, Number(r.available)]));
}
