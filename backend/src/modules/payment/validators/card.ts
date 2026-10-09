import { z } from "zod";

/** Format-only card validation (AC-MP-12): no Luhn check, and an expired but well-formed date is accepted. */
export const cardSchema = z.object({
  cardNumber: z
    .string()
    .transform((value) => value.replaceAll(" ", ""))
    .pipe(z.string().regex(/^\d{13,19}$/, "Card number must be 13-19 digits")),
  name: z.string().trim().max(100).optional(),
  expiry: z
    .string()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Expiry must be MM/YY")
    .optional(),
  cvv: z
    .string()
    .regex(/^\d{3,4}$/, "CVV must be 3-4 digits")
    .optional(),
});

/** Internal webhook body: the mock payment service reports the outcome of one payment. */
export const callbackSchema = z.object({
  paymentId: z.uuid(),
  result: z.enum(["SUCCESS", "FAILED"]),
  mockRef: z.string().min(1),
  failureCode: z.enum(["MOCK_DECLINED", "MOCK_TIMEOUT"]).optional(),
});

export type CardInput = z.infer<typeof cardSchema>;

export const paymentIdParamsSchema = z.object({
  paymentId: z.uuid(),
});
