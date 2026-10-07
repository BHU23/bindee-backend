import type { PrismaClient } from "@/database/generated/client.js";
import {
  addDays,
  bangkokDayRange,
} from "@/modules/inventory/services/dates.js";
import { priceParty } from "@/modules/inventory/services/pricing.js";
import type {
  CalendarDay,
  FromPrice,
  PaxCounts,
  RoutePair,
  SearchQuery,
  SearchResult,
} from "@/modules/inventory/types/inventory.js";
import type { SnapshotPrices } from "./snapshot.js";
import { countAvailableSeats } from "./availability.js";
import {
  liteAdultPrice,
  seatsNeeded,
  toFlightOption,
  type FlightWithFares,
} from "./flightOptions.js";

export const CALENDAR_DAYS_EACH_SIDE = 3;

async function flightsBetween(
  prisma: PrismaClient,
  pair: RoutePair,
  start: Date,
  end: Date,
): Promise<FlightWithFares[]> {
  return prisma.flight.findMany({
    where: {
      route: { originCode: pair.origin, destinationCode: pair.destination },
      departAt: { gte: start, lt: end },
    },
    include: { route: true, fares: true },
    orderBy: { departAt: "asc" },
  });
}

function buildCalendar(
  flights: FlightWithFares[],
  available: Map<string, number>,
  centerDate: string,
  pax: PaxCounts,
): CalendarDay[] {
  const need = seatsNeeded(pax);
  const days: CalendarDay[] = [];
  for (
    let offset = -CALENDAR_DAYS_EACH_SIDE;
    offset <= CALENDAR_DAYS_EACH_SIDE;
    offset++
  ) {
    const date = addDays(centerDate, offset);
    const { start, end } = bangkokDayRange(date);
    const prices = flights
      .filter((f) => f.departAt >= start && f.departAt < end)
      .filter((f) => (available.get(f.id) ?? 0) >= need)
      .map(liteAdultPrice)
      .filter((p): p is number => p !== null);
    days.push({
      date,
      lowestFare: prices.length > 0 ? Math.min(...prices) : null,
      soldOut: prices.length === 0,
    });
  }
  return days;
}

export async function searchFlights(
  prisma: PrismaClient,
  now: Date,
  query: SearchQuery,
): Promise<SearchResult> {
  const pax: PaxCounts = {
    adults: query.adults,
    children: query.children,
    infants: query.infants,
  };
  const pair = { origin: query.origin, destination: query.destination };
  const calendarStart = bangkokDayRange(
    addDays(query.departDate, -CALENDAR_DAYS_EACH_SIDE),
  ).start;
  const calendarEnd = bangkokDayRange(
    addDays(query.departDate, CALENDAR_DAYS_EACH_SIDE),
  ).end;
  const outboundWindow = await flightsBetween(
    prisma,
    pair,
    calendarStart,
    calendarEnd,
  );
  const inboundFlights = query.returnDate
    ? await flightsBetween(
        prisma,
        { origin: query.destination, destination: query.origin },
        bangkokDayRange(query.returnDate).start,
        bangkokDayRange(query.returnDate).end,
      )
    : [];

  const available = await countAvailableSeats(
    prisma,
    [...outboundWindow, ...inboundFlights].map((f) => f.id),
    now,
  );
  const day = bangkokDayRange(query.departDate);
  const outboundFlights = outboundWindow.filter(
    (f) => f.departAt >= day.start && f.departAt < day.end,
  );

  function toOption(f: FlightWithFares) {
    return toFlightOption(f, available.get(f.id) ?? 0, pax);
  }
  const snapshotPrices: SnapshotPrices = {};
  for (const f of [...outboundFlights, ...inboundFlights]) {
    snapshotPrices[f.id] = Object.fromEntries(
      f.fares.map((fare) => {
        const party = priceParty(fare, f.priceFactor.toNumber(), pax);
        return [
          fare.family,
          { perAdult: party.perAdult, perInfant: party.perInfant },
        ];
      }),
    );
  }
  const snapshot = await prisma.searchSnapshot.create({
    data: { createdAt: now, data: { pax: { ...pax }, prices: snapshotPrices } },
  });

  const international =
    [...outboundFlights, ...inboundFlights][0]?.route.international ?? false;
  return {
    searchId: snapshot.id,
    international,
    outbound: outboundFlights.map(toOption),
    ...(query.returnDate ? { inbound: inboundFlights.map(toOption) } : {}),
    calendar: buildCalendar(outboundWindow, available, query.departDate, pax),
  };
}

export async function getFromPrices(
  prisma: PrismaClient,
  now: Date,
  input: { routes: RoutePair[]; days: number },
): Promise<FromPrice[]> {
  const end = new Date(now.getTime() + input.days * 86_400_000);
  const results: FromPrice[] = [];
  for (const pair of input.routes) {
    const flights = await flightsBetween(prisma, pair, now, end);
    const available = await countAvailableSeats(
      prisma,
      flights.map((f) => f.id),
      now,
    );
    const prices = flights
      .filter((f) => (available.get(f.id) ?? 0) > 0)
      .map(liteAdultPrice)
      .filter((p): p is number => p !== null);
    results.push({
      ...pair,
      price: prices.length > 0 ? Math.min(...prices) : null,
    });
  }
  return results;
}
