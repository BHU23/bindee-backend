import type { FastifyInstance } from "fastify";
import { createSearchController } from "../controllers/searchController.js";
import type { SearchService } from "../services/searchService.js";

export function searchRoutes(service: SearchService) {
  const controller = createSearchController(service);
  return async function searchPlugin(app: FastifyInstance): Promise<void> {
    app.post("/searches", controller.create);
    app.get("/searches/recent", controller.recent);
    app.get("/routes/popular", controller.popularRoutes);
    app.get("/promotions", controller.promotions);
    app.get("/searches/:searchId/flights", controller.flights);
  };
}
