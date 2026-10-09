import { z } from "zod";

export const confirmBookingSchema = z.object({
  draftId: z.uuid(),
  acceptTerms: z.literal(true),
  expectedTotal: z.number().int().positive(),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;
