import type { FastifyReply, FastifyRequest } from "fastify";
import type { BookingService } from "../services/bookingService.js";

export interface BookingController {
  createDraft(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  selectOutbound(request: FastifyRequest): Promise<unknown>;
}

export function createBookingController(
  service: BookingService,
): BookingController {
  return {
    async createDraft(request, reply) {
      const body = await service.createDraft(request.body, request.sessionId);
      return reply.status(201).send(body);
    },
    selectOutbound: (request) =>
      service.selectOutbound(request.params, request.body, request.sessionId),
  };
}
