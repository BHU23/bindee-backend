import type { PrismaClient } from "@/database/generated/client.js";
import type { Clock } from "@/core/utils/clock.js";
import { validate } from "@/core/utils/validate.js";
import type { InventoryPort, SearchQuery } from "@/modules/inventory/index.js";
import { createPromotionRepository } from "../repositories/promotionRepository.js";
import { createRecentSearchRepository } from "../repositories/recentSearchRepository.js";
import type {
  CreateSearchResponse,
  PopularRouteResponse,
  PromotionResponse,
  RecentSearchResponse,
} from "../types/search.js";
import { createSearchSchema } from "../validators/createSearch.js";
import {
  popularRouteView,
  promotionView,
  recentSearchView,
} from "../views/searchView.js";
import { bangkokToday } from "./dates.js";
import { queryKey } from "./queryKey.js";

export const SEARCH_TTL_MS = 20 * 60 * 1000;
export const RECENT_LIMIT = 5;
export const POPULAR_DAYS = 30;
export const POPULAR_ROUTES = [
  { origin: "BKK", destination: "CNX", city: "Chiang Mai" },
  { origin: "BKK", destination: "HKT", city: "Phuket" },
  { origin: "BKK", destination: "SIN", city: "Singapore" },
  { origin: "BKK", destination: "NRT", city: "Tokyo" },
];

export interface SearchService {
  createSearch(
    body: unknown,
    sessionId?: string,
  ): Promise<CreateSearchResponse>;
  listRecent(sessionId?: string): Promise<RecentSearchResponse[]>;
  listPopularRoutes(): Promise<PopularRouteResponse[]>;
  listPromotions(): Promise<PromotionResponse[]>;
}

export interface SearchServiceDeps {
  prisma: PrismaClient;
  clock: Clock;
  inventory: InventoryPort;
}

export function createSearchService(deps: SearchServiceDeps): SearchService {
  const { prisma, clock, inventory } = deps;
  const recents = createRecentSearchRepository(prisma);
  const promotions = createPromotionRepository(prisma);

  return {
    async createSearch(body, sessionId) {
      const input = validate(
        createSearchSchema(bangkokToday(clock.now())),
        body,
      );
      const query: SearchQuery = input;
      const { searchId } = await inventory.searchFlights(query);
      const now = clock.now();
      if (sessionId !== undefined) {
        await recents.upsert({
          sessionId,
          queryKey: queryKey(query),
          query,
          searchedAt: new Date(now),
        });
      }
      return {
        searchId,
        expiresAt: new Date(now + SEARCH_TTL_MS).toISOString(),
      };
    },

    async listRecent(sessionId) {
      if (sessionId === undefined) return [];
      const records = await recents.listLatest(sessionId, RECENT_LIMIT);
      return records.map(recentSearchView);
    },

    async listPopularRoutes() {
      const prices = await inventory.getFromPrices({
        routes: POPULAR_ROUTES.map(({ origin, destination }) => ({
          origin,
          destination,
        })),
        days: POPULAR_DAYS,
      });
      return prices.map((price) =>
        popularRouteView(
          price,
          POPULAR_ROUTES.find((r) => r.destination === price.destination)
            ?.city ?? price.destination,
        ),
      );
    },

    async listPromotions() {
      const records = await promotions.findValid(new Date(clock.now()));
      return records.map(promotionView);
    },
  };
}
