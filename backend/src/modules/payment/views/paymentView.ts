import type {
  PaymentMethodResponse,
  PaymentRecord,
  StartPaymentResponse,
} from "../types/payment.js";
import { nextPageFor, type PaymentMethod } from "../validators/payment.js";

export function paymentMethodView(
  method: PaymentMethod,
): PaymentMethodResponse {
  return { method, next: nextPageFor(method) };
}

export function startPaymentView(payment: PaymentRecord): StartPaymentResponse {
  return {
    paymentId: payment.id,
    status: "PENDING",
    amount: payment.amount,
    currency: payment.currency,
    expiresAt: payment.expiresAt.toISOString(),
    mockRef: payment.mockRef,
  };
}
