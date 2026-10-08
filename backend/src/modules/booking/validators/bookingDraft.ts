import { z } from "zod";

export const createDraftSchema = z.object({ searchId: z.uuid() });

export const draftParamsSchema = z.object({ draftId: z.uuid() });

export const faresParamsSchema = z.object({
  draftId: z.uuid(),
  flightId: z.uuid(),
});

export const selectFareSchema = z.object({
  flightId: z.uuid(),
  fareFamily: z.enum(["LITE", "VALUE", "FLEX"]),
});

export const acceptPriceSchema = z.object({
  newPrice: z.number().int().positive(),
});
