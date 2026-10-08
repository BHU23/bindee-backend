import type { FastifyReply, FastifyRequest } from "fastify";
import type { SearchService } from "../services/searchService.js";

export interface SearchController {
  create(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  recent(request: FastifyRequest): Promise<unknown>;
  popularRoutes(): Promise<unknown>;
  promotions(): Promise<unknown>;
  flights(request: FastifyRequest): Promise<unknown>;
}

export function createSearchController(
  service: SearchService,
): SearchController {
  return {
    async create(request, reply) {
      const body = await service.createSearch(request.body, request.sessionId);
      return reply.status(201).send(body);
    },
    recent: (request) => service.listRecent(request.sessionId),
    popularRoutes: () => service.listPopularRoutes(),
    promotions: () => service.listPromotions(),
    flights: (request) =>
      service.listFlights(
        (request.params as { searchId: string }).searchId,
        request.query,
        request.sessionId,
      ),
  };
}
