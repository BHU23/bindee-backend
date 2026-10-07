import {
  NotFoundError,
  SearchExpiredError,
} from "../../../core/errors/index.js";
import type { PrismaClient } from "../../../database/generated/client.js";
import { priceParty } from "../services/pricing.js";
import type { RepriceInput, RepriceResult } from "../types/inventory.js";
import { countAvailableSeats } from "./availability.js";
import { seatsNeeded } from "./flightOptions.js";
import { SNAPSHOT_TTL_MS, type SnapshotData } from "./snapshot.js";

/** Per adult/child increase applied by a price-change trigger (HS-1). */
export const FORCED_PRICE_STEP = 100;

export interface RepriceContext {
  now: Date;
  forcePriceChangeFlight?: string;
}

export async function reprice(
  prisma: PrismaClient,
  context: RepriceContext,
  input: RepriceInput,
): Promise<RepriceResult> {
  const snapshot = await prisma.searchSnapshot.findUnique({
    where: { id: input.searchId },
  });
  if (
    !snapshot ||
    context.now.getTime() - snapshot.createdAt.getTime() > SNAPSHOT_TTL_MS
  ) {
    throw new SearchExpiredError();
  }
  const flight = await prisma.flight.findUnique({
    where: { id: input.flightId },
    include: { fares: true },
  });
  if (!flight) throw new NotFoundError("NOT_FOUND", "Flight not found");

  const fare = flight.fares.find((f) => f.family === input.fareFamily);
  const quoted = (snapshot.data as unknown as SnapshotData).prices[flight.id]?.[
    input.fareFamily
  ];
  if (!fare || !quoted) {
    throw new NotFoundError("NOT_FOUND", "Fare was not part of this search");
  }

  const { paxCounts } = input;
  const payingPax = paxCounts.adults + paxCounts.children;
  const oldPrice =
    quoted.perAdult * payingPax + quoted.perInfant * paxCounts.infants;
  const current = priceParty(fare, flight.priceFactor.toNumber(), paxCounts);
  const forced =
    fare.repriceTrigger || context.forcePriceChangeFlight === flight.flightNo;
  const perPax = {
    adult: current.perAdult + (forced ? FORCED_PRICE_STEP : 0),
    child: current.perChild + (forced ? FORCED_PRICE_STEP : 0),
    infant: current.perInfant,
  };
  const newPrice = perPax.adult * payingPax + perPax.infant * paxCounts.infants;

  const available = await countAvailableSeats(prisma, [flight.id], context.now);
  if ((available.get(flight.id) ?? 0) < seatsNeeded(paxCounts)) {
    return {
      changed: true,
      oldPrice,
      newPrice,
      perPax,
      reason: "FARE_SOLD_OUT",
    };
  }
  if (newPrice !== oldPrice) {
    return {
      changed: true,
      oldPrice,
      newPrice,
      perPax,
      reason: "PRICE_UPDATED",
    };
  }
  return { changed: false, oldPrice, newPrice, perPax };
}
