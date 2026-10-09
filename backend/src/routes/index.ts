import type { FastifyInstance } from "fastify";
import { bookingRoutes, type BookingService } from "@/modules/booking/index.js";
import { paymentRoutes, type PaymentService } from "@/modules/payment/index.js";
import { searchRoutes, type SearchService } from "@/modules/search/index.js";

export interface RouteDeps {
  searchService?: SearchService;
  bookingService?: BookingService;
  paymentService?: PaymentService;
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
  if (deps.paymentService) {
    await app.register(paymentRoutes(deps.paymentService), {
      prefix: "/api/v1",
    });
  }
}
