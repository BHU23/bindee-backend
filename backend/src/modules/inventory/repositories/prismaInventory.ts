import type { PrismaClient } from "../../../database/generated/client.js";
import type { Clock } from "../../../core/utils/clock.js";
import { searchQuerySchema } from "../validators/searchQuery.js";
import type { InventoryPort } from "../types/inventory.js";
import { guard } from "./guard.js";
import { findAlternatives } from "./alternatives.js";
import { extendOrRehold, holdSeats, releaseSeats } from "./holds.js";
import { reprice } from "./reprice.js";
import { getFromPrices, searchFlights } from "./search.js";
import { getSeatMap } from "./seatMap.js";

export interface InventoryDeps {
  prisma: PrismaClient;
  clock: Clock;
  /** Flight number whose reprice reports a changed price (INVENTORY_FORCE_PRICE_CHANGE). */
  forcePriceChangeFlight?: string;
}

export function createPrismaInventory(deps: InventoryDeps): InventoryPort {
  function now(): Date {
    return new Date(deps.clock.now());
  }
  return {
    searchFlights: (query) =>
      guard(() =>
        searchFlights(deps.prisma, now(), searchQuerySchema.parse(query)),
      ),
    reprice: (input) =>
      guard(() =>
        reprice(
          deps.prisma,
          {
            now: now(),
            forcePriceChangeFlight: deps.forcePriceChangeFlight,
          },
          input,
        ),
      ),
    getSeatMap: (flightId) =>
      guard(() => getSeatMap(deps.prisma, now(), flightId)),
    holdSeats: (request) => guard(() => holdSeats(deps.prisma, now(), request)),
    releaseSeats: (holdId) =>
      guard(() => releaseSeats(deps.prisma, now(), holdId)),
    extendOrRehold: (holdId) =>
      guard(() => extendOrRehold(deps.prisma, now(), holdId)),
    findAlternatives: (input) =>
      guard(() => findAlternatives(deps.prisma, now(), input)),
    getFromPrices: (input) =>
      guard(() => getFromPrices(deps.prisma, now(), input)),
  };
}
