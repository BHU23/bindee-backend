import { z } from "zod";

/** Iteration 0 offers card only; PromptPay QR and mobile banking (AC-PM-04) come later. */
export const PAYMENT_METHODS = ["CARD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const NEXT_PAGE: Record<PaymentMethod, string> = {
  CARD: "/pay/card",
};

export function nextPageFor(method: PaymentMethod): string {
  return NEXT_PAGE[method];
}

export const paymentMethodSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
});

export const pnrParamsSchema = z.object({
  pnr: z.string().regex(/^[A-Z0-9]{6}$/),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
