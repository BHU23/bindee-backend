import type { FastifyInstance } from "fastify";
import { createPaymentController } from "../controllers/paymentController.js";
import type { PaymentService } from "../services/paymentService.js";

export function paymentRoutes(service: PaymentService) {
  const controller = createPaymentController(service);
  return async function paymentPlugin(app: FastifyInstance): Promise<void> {
    app.put("/bookings/:pnr/payment-method", controller.saveMethod);
    app.post("/bookings/:pnr/payments", controller.startPayment);
  };
}
