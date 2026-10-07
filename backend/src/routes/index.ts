import type { FastifyInstance } from "fastify";
import { searchRoutes, type SearchService } from "@/modules/search/index.js";

export interface RouteDeps {
  searchService?: SearchService;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDeps = {},
): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
  if (deps.searchService) {
    await app.register(searchRoutes(deps.searchService), { prefix: "/api/v1" });
  }
}
