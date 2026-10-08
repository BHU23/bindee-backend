import { Prisma, type PrismaClient } from "@/database/generated/client.js";
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
import type { SnapshotData, SnapshotPrices } from "./snapshot.js";
import { countAvailableSeats } from "./availability.js";
import {
  FLIGHT_INCLUDE,
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
    include: FLIGHT_INCLUDE,
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
    const open = flights
      .filter((f) => f.departAt >= start && f.departAt < end)
      .filter((f) => (available.get(f.id) ?? 0) >= need);
    const prices = open
      .map(liteAdultPrice)
      .filter((p): p is number => p !== null);
    days.push({
      date,
      lowestFare: prices.length > 0 ? Math.min(...prices) : null,
      seatsLeft: open.reduce((n, f) => n + (available.get(f.id) ?? 0), 0),
      soldOut: prices.length === 0,
    });
  }
  return days;
}

export async function searchFlights(
  prisma: PrismaClient,
  now: Date,
  query: SearchQuery,
  sessionId?: string,
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
  const outbound = outboundFlights.map(toOption);
  const inbound = query.returnDate ? inboundFlights.map(toOption) : undefined;
  const calendar = buildCalendar(
    outboundWindow,
    available,
    query.departDate,
    pax,
  );
  const data: SnapshotData = {
    pax: { ...pax },
    prices: snapshotPrices,
    results: { outbound, ...(inbound ? { inbound } : {}), calendar },
    query,
    sessionId: sessionId ?? null,
  };
  const snapshot = await prisma.searchSnapshot.create({
    data: { createdAt: now, data: data as unknown as Prisma.InputJsonObject },
  });

  const international =
    [...outboundFlights, ...inboundFlights][0]?.route.international ?? false;
  return {
    searchId: snapshot.id,
    international,
    outbound,
    ...(inbound ? { inbound } : {}),
    calendar,
  };
}

interface FromPriceRow {
  origin_code: string;
  destination_code: string;
  price: number;
}

/**
 * Lowest Lite adult fare (incl. taxes) per route over the next `days`, among flights with a free
 * seat. One grouped query: the database computes the minimum, nothing is loaded and discarded.
 * The fare formula mirrors `adultPrice` in services/pricing.ts.
 */
export async function getFromPrices(
  prisma: PrismaClient,
  now: Date,
  input: { routes: RoutePair[]; days: number },
): Promise<FromPrice[]> {
  if (input.routes.length === 0) return [];
  const end = new Date(now.getTime() + input.days * 86_400_000);
  const pairs = Prisma.join(
    input.routes.map((r) => Prisma.sql`(${r.origin}, ${r.destination})`),
  );
  const rows = await prisma.$queryRaw<FromPriceRow[]>`
    SELECT r.origin_code, r.destination_code,
      MIN(
        ROUND(ff.base_price * f.price_factor)
        + ff.airport_tax + ff.fuel_surcharge + ff.service_fee
      )::int AS price
    FROM flight f
    JOIN route r ON r.id = f.route_id
    JOIN flight_fare ff ON ff.flight_id = f.id AND ff.family = 'LITE'
    WHERE (r.origin_code, r.destination_code) IN (VALUES ${pairs})
      AND f.depart_at >= ${now} AND f.depart_at < ${end}
      AND EXISTS (
        SELECT 1
        FROM seat s
        WHERE s.flight_id = f.id
          AND s.status = 'AVAILABLE'
          AND NOT EXISTS (
            SELECT 1
            FROM seat_hold_item i
            JOIN seat_hold h ON h.id = i.hold_id
            WHERE i.seat_id = s.id AND h.released_at IS NULL AND h.expires_at > ${now}
          )
      )
    GROUP BY r.origin_code, r.destination_code`;
  const byRoute = new Map(
    rows.map((row) => [
      `${row.origin_code}>${row.destination_code}`,
      row.price,
    ]),
  );
  return input.routes.map((pair) => ({
    ...pair,
    price: byRoute.get(`${pair.origin}>${pair.destination}`) ?? null,
  }));
}
