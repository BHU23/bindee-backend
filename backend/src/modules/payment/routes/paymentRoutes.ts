import type { FastifyInstance } from "fastify";
import { createPaymentController } from "../controllers/paymentController.js";
import { requireCallbackSecret } from "../validators/callbackSecret.js";
import type { PaymentService } from "../services/paymentService.js";

export interface PaymentRoutesOptions {
  /** When set, `/mock-payment/callback` needs this value in `X-Callback-Secret`. */
  callbackSecret?: string;
}

export function paymentRoutes(
  service: PaymentService,
  options: PaymentRoutesOptions = {},
) {
  const controller = createPaymentController(service);
  const requireSecret = requireCallbackSecret(options.callbackSecret);
  return async function paymentPlugin(app: FastifyInstance): Promise<void> {
    app.put("/bookings/:pnr/payment-method", controller.saveMethod);
    app.post("/bookings/:pnr/payments", controller.startPayment);
    app.post("/payments/:paymentId/card", controller.payByCard);
    app.post(
      "/mock-payment/callback",
      { preHandler: requireSecret },
      controller.callback,
    );
  };
}
