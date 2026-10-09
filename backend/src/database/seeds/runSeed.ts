import type { PrismaClient } from "@/database/generated/client.js";
import {
  ADDON_PRICES,
  AIRPORTS,
  PROMOTIONS,
  PROMO_CODES,
  SEED_DAYS,
  bangkokMidnight,
  buildFlightPlans,
  buildRoutePlans,
  buildSeatPlans,
  type AircraftName,
  type FlightPlan,
  type SeatPlan,
} from "./data.js";

const BATCH_SIZE = 5000;

export interface SeedOptions {
  now?: Date;
  days?: number;
}

export interface SeedSummary {
  airports: number;
  routes: number;
  flights: number;
  fares: number;
  seats: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function flightKey(flightNo: string, departAt: Date): string {
  return `${flightNo}|${departAt.getTime()}`;
}

function seatStatus(
  plan: FlightPlan,
  seat: SeatPlan,
  lastSeat: SeatPlan | undefined,
): "AVAILABLE" | "SOLD" {
  if (plan.soldOut) return "SOLD";
  if (plan.seatsLeft !== undefined) {
    return seat === lastSeat ? "AVAILABLE" : "SOLD";
  }
  return "AVAILABLE";
}

/** Idempotent: every write is keyed on a natural key, so a second run adds nothing. */
export async function runSeed(
  prisma: PrismaClient,
  options: SeedOptions = {},
): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const days = options.days ?? SEED_DAYS;

  for (const airport of AIRPORTS) {
    await prisma.airport.upsert({
      where: { code: airport.code },
      update: { timezone: airport.timezone },
      create: airport,
    });
  }

  const routeIds = new Map<string, string>();
  for (const route of buildRoutePlans()) {
    const saved = await prisma.route.upsert({
      where: {
        originCode_destinationCode: {
          originCode: route.origin,
          destinationCode: route.destination,
        },
      },
      update: {},
      create: {
        originCode: route.origin,
        destinationCode: route.destination,
        international: route.international,
        durationMinutes: route.durationMinutes,
      },
    });
    routeIds.set(`${route.origin}-${route.destination}`, saved.id);
  }

  const plans = buildFlightPlans(now, days);
  const planByKey = new Map(
    plans.map((p) => [flightKey(p.flightNo, p.departAt), p]),
  );

  for (const batch of chunk(plans, BATCH_SIZE)) {
    await prisma.flight.createMany({
      skipDuplicates: true,
      data: batch.map((p) => ({
        flightNo: p.flightNo,
        routeId: routeIds.get(`${p.origin}-${p.destination}`) as string,
        departAt: p.departAt,
        arriveAt: p.arriveAt,
        aircraft: p.aircraft,
        priceFactor: p.priceFactor,
        stops: p.stops,
      })),
    });
  }

  const earliest = bangkokMidnight(now);
  const saved = await prisma.flight.findMany({
    where: { departAt: { gte: earliest } },
    select: { id: true, flightNo: true, departAt: true },
  });
  const unfilled = await prisma.flight.findMany({
    where: {
      departAt: { gte: earliest },
      OR: [{ fares: { none: {} } }, { seats: { none: {} } }],
    },
    select: { id: true, flightNo: true, departAt: true },
  });

  const fareRows = unfilled.flatMap((flight) => {
    const plan = planByKey.get(flightKey(flight.flightNo, flight.departAt));
    return (plan?.fares ?? []).map((fare) => ({
      flightId: flight.id,
      ...fare,
    }));
  });
  for (const batch of chunk(fareRows, BATCH_SIZE)) {
    await prisma.flightFare.createMany({ skipDuplicates: true, data: batch });
  }

  const layouts = new Map<AircraftName, SeatPlan[]>();
  let seatsCreated = 0;
  for (const flight of unfilled) {
    const plan = planByKey.get(flightKey(flight.flightNo, flight.departAt));
    if (!plan) continue;
    const layout = layouts.get(plan.aircraft) ?? buildSeatPlans(plan.aircraft);
    layouts.set(plan.aircraft, layout);
    const lastSeat = layout[layout.length - 1];
    const rows = layout.map((seat) => ({
      flightId: flight.id,
      row: seat.row,
      letter: seat.letter,
      kind: seat.kind,
      price: seat.price,
      status: seatStatus(plan, seat, lastSeat),
    }));
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const result = await prisma.seat.createMany({
        skipDuplicates: true,
        data: batch,
      });
      seatsCreated += result.count;
    }
  }

  for (const promo of PROMO_CODES) {
    await prisma.promoCode.upsert({
      where: { code: promo.code },
      update: {},
      create: promo,
    });
  }
  for (const promotion of PROMOTIONS) {
    await prisma.promotion.upsert({
      where: { id: promotion.id },
      update: {},
      create: promotion,
    });
  }
  for (const addon of ADDON_PRICES) {
    await prisma.addonPrice.upsert({
      where: { category_code: { category: addon.category, code: addon.code } },
      update: {},
      create: addon,
    });
  }

  return {
    airports: AIRPORTS.length,
    routes: routeIds.size,
    flights: saved.length,
    fares: fareRows.length,
    seats: seatsCreated,
  };
}
