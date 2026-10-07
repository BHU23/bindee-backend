import type { PrismaClient } from "../../../database/generated/client.js";
import type { Clock } from "../../../core/utils/clock.js";
import { searchQuerySchema } from "../validators/searchQuery.js";
import type { InventoryPort } from "../types/inventory.js";
import { guard } from "./guard.js";
import { getFromPrices, searchFlights } from "./search.js";

export interface InventoryDeps {
  prisma: PrismaClient;
  clock: Clock;
  /** Flight number whose reprice reports a changed price (INVENTORY_FORCE_PRICE_CHANGE). */
  forcePriceChangeFlight?: string;
}

export type ImplementedInventory = Pick<
  InventoryPort,
  "searchFlights" | "getFromPrices"
>;

export function createPrismaInventory(
  deps: InventoryDeps,
): ImplementedInventory {
  function now(): Date {
    return new Date(deps.clock.now());
  }
  return {
    searchFlights: (query) =>
      guard(() =>
        searchFlights(deps.prisma, now(), searchQuerySchema.parse(query)),
      ),
    getFromPrices: (input) =>
      guard(() => getFromPrices(deps.prisma, now(), input)),
  };
}
