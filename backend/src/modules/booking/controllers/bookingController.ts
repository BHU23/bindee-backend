import type { FastifyReply, FastifyRequest } from "fastify";
import type { BookingService } from "../services/bookingService.js";
import type { BookingLeg } from "../types/bookingDraft.js";

export interface BookingController {
  createDraft(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  getFares(request: FastifyRequest): Promise<unknown>;
  listReturnFlights(request: FastifyRequest): Promise<unknown>;
  selectFare(leg: BookingLeg): (request: FastifyRequest) => Promise<unknown>;
  savePassengers(request: FastifyRequest): Promise<unknown>;
  getPassengers(request: FastifyRequest): Promise<unknown>;
  acceptPrice(leg: BookingLeg): (request: FastifyRequest) => Promise<unknown>;
  createBooking(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  getBooking(request: FastifyRequest): Promise<unknown>;
}

export function createBookingController(
  service: BookingService,
): BookingController {
  return {
    async createDraft(request, reply) {
      const body = await service.createDraft(request.body, request.sessionId);
      return reply.status(201).send(body);
    },
    async createBooking(request, reply) {
      const body = await service.createBooking(
        request.headers["idempotency-key"],
        request.body,
        request.sessionId,
      );
      return reply.status(201).send(body);
    },
    getBooking: (request) =>
      service.getBooking(request.params, request.sessionId),
    getFares: (request) => service.getFares(request.params, request.sessionId),
    listReturnFlights: (request) =>
      service.listReturnFlights(request.params, request.sessionId),
    savePassengers: (request) =>
      service.savePassengers(request.params, request.body, request.sessionId),
    getPassengers: (request) =>
      service.getPassengers(request.params, request.sessionId),
    selectFare: (leg) => (request) =>
      service.selectFare(leg, request.params, request.body, request.sessionId),
    acceptPrice: (leg) => (request) =>
      service.acceptPrice(leg, request.params, request.body, request.sessionId),
  };
}
