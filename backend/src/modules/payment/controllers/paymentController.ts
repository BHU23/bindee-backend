import type { FastifyReply, FastifyRequest } from "fastify";
import type { PaymentService } from "../services/paymentService.js";

export interface PaymentController {
  saveMethod(request: FastifyRequest): Promise<unknown>;
  startPayment(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  payByCard(request: FastifyRequest): Promise<unknown>;
  callback(request: FastifyRequest): Promise<unknown>;
  retryPayment(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  latestPayment(request: FastifyRequest): Promise<unknown>;
}

export function createPaymentController(
  service: PaymentService,
): PaymentController {
  return {
    saveMethod: (request) =>
      service.saveMethod(request.params, request.body, request.sessionId),
    payByCard: (request) =>
      service.payByCard(request.params, request.body, request.sessionId),
    callback: (request) => service.handleCallback(request.body),
    latestPayment: (request) =>
      service.latestPayment(request.params, request.sessionId),
    async startPayment(request, reply) {
      const body = await service.startPayment(
        request.params,
        request.headers["idempotency-key"],
        request.body,
        request.sessionId,
      );
      return reply.status(201).send(body);
    },
    async retryPayment(request, reply) {
      const body = await service.retryPayment(
        request.params,
        request.headers["idempotency-key"],
        request.body,
        request.sessionId,
      );
      return reply.status(201).send(body);
    },
  };
}
