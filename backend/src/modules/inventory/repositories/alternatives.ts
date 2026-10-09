import { NotFoundError } from "@/core/errors/index.js";
import type { PrismaClient } from "@/database/generated/client.js";
import { bangkokDayIndex } from "@/modules/inventory/services/dates.js";
import type { FlightOption } from "@/modules/inventory/types/inventory.js";
import { countAvailableSeats } from "./availability.js";
import { FLIGHT_INCLUDE, toFlightOption } from "./flightOptions.js";

const DAY_MS = 86_400_000;

/**
 * Other flights of the same route and direction with room for the party: later flights on the
 * original day first, then flights on other days within `dayWindow`, nearest day first.
 */
export async function findAlternatives(
  prisma: PrismaClient,
  now: Date,
  input: { flightId: string; paxCount: number; dayWindow: number },
): Promise<FlightOption[]> {
  const original = await prisma.flight.findUnique({
    where: { id: input.flightId },
  });
  if (!original) throw new NotFoundError("NOT_FOUND", "Flight not found");

  const originalDay = bangkokDayIndex(original.departAt);
  const windowMs = input.dayWindow * DAY_MS;
  const candidates = await prisma.flight.findMany({
    where: {
      routeId: original.routeId,
      id: { not: original.id },
      departAt: {
        gte: new Date(original.departAt.getTime() - windowMs - DAY_MS),
        lt: new Date(original.departAt.getTime() + windowMs + DAY_MS),
      },
    },
    include: FLIGHT_INCLUDE,
  });

  const available = await countAvailableSeats(
    prisma,
    candidates.map((f) => f.id),
    now,
  );
  const pax = { adults: input.paxCount, children: 0, infants: 0 };
  return candidates
    .map((flight) => ({
      flight,
      distance: Math.abs(bangkokDayIndex(flight.departAt) - originalDay),
    }))
    .filter(
      ({ flight, distance }) =>
        distance <= input.dayWindow &&
        (available.get(flight.id) ?? 0) >= input.paxCount &&
        (distance > 0 || flight.departAt > original.departAt),
    )
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.flight.departAt.getTime() - b.flight.departAt.getTime(),
    )
    .map(({ flight }) =>
      toFlightOption(flight, available.get(flight.id) ?? 0, pax),
    );
}
