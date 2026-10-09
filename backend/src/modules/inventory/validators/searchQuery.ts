import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iata = z.string().length(3).toUpperCase();

export const searchQuerySchema = z.object({
  tripType: z.enum(["ONE_WAY", "ROUND_TRIP"]),
  origin: iata,
  destination: iata,
  departDate: day,
  returnDate: day.optional(),
  adults: z.number().int().min(1).max(9),
  children: z.number().int().min(0).max(9),
  infants: z.number().int().min(0).max(9),
  cabin: z.literal("ECONOMY"),
});
