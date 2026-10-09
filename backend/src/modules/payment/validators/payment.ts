import { z } from "zod";

export const PAYMENT_METHODS = [
  "CARD",
  "PROMPTPAY_QR",
  "MOBILE_BANKING",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Banks offered for mobile banking; the choice itself is made on the mock-payment page. */
export const BANKS = ["KBANK", "SCB", "KRUNGSRI", "BBL", "TTB"] as const;
export type Bank = (typeof BANKS)[number];

const NEXT_PAGE: Record<PaymentMethod, string> = {
  CARD: "/pay/card",
  PROMPTPAY_QR: "/pay/qr",
  MOBILE_BANKING: "/pay/mobile-banking",
};

export function nextPageFor(method: PaymentMethod): string {
  return NEXT_PAGE[method];
}

/** `bank` is optional here (AC-PM-04); when present it must be an offered bank. It is validated, not stored. */
export const paymentMethodSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  bank: z.enum(BANKS).optional(),
});

/** Retry body: without `method` the previous attempt's method is reused. */
export const retryPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS).optional(),
  bank: z.enum(BANKS).optional(),
});

export const pnrParamsSchema = z.object({
  pnr: z.string().regex(/^[A-Z0-9]{6}$/),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
