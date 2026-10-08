import type { FastifyInstance } from "fastify";
import { bookingRoutes, type BookingService } from "@/modules/booking/index.js";
import { searchRoutes, type SearchService } from "@/modules/search/index.js";

export interface RouteDeps {
  searchService?: SearchService;
  bookingService?: BookingService;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDeps = {},
): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
  if (deps.searchService) {
    await app.register(searchRoutes(deps.searchService), { prefix: "/api/v1" });
  }
  if (deps.bookingService) {
    await app.register(bookingRoutes(deps.bookingService), {
      prefix: "/api/v1",
    });
  }
}
