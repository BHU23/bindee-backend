import { z } from "zod";
import { addDays, isRealDay } from "../services/dates.js";

export const MAX_DAYS_AHEAD = 330;
export const MAX_SEATED_PAX = 9;

const iata = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter airport code")
  .transform((code) => code.toUpperCase());
const day = z.string().refine(isRealDay, "Use a date as YYYY-MM-DD");

/** Body schema of POST /searches; `today` is the Bangkok calendar day. */
export function createSearchSchema(today: string) {
  const latest = addDays(today, MAX_DAYS_AHEAD);
  return z
    .object({
      tripType: z.enum(["ONE_WAY", "ROUND_TRIP"]),
      origin: iata,
      destination: iata,
      departDate: day,
      returnDate: day.optional(),
      adults: z.number().int().min(1, "At least 1 adult is required"),
      children: z.number().int().min(0).default(0),
      infants: z.number().int().min(0).default(0),
      cabin: z.literal("ECONOMY").default("ECONOMY"),
    })
    .superRefine((value, ctx) => {
      function issue(path: string, message: string): void {
        ctx.addIssue({ code: "custom", path: [path], message });
      }
      if (value.origin === value.destination) {
        issue("destination", "Choose a destination different from the origin");
      }
      if (isRealDay(value.departDate)) {
        if (value.departDate < today) {
          issue("departDate", "Departure date cannot be in the past");
        } else if (value.departDate > latest) {
          issue(
            "departDate",
            `Departure date must be within ${MAX_DAYS_AHEAD} days`,
          );
        }
      }
      if (value.tripType === "ROUND_TRIP") {
        if (value.returnDate === undefined) {
          issue("returnDate", "Choose a return date");
        } else if (
          isRealDay(value.returnDate) &&
          isRealDay(value.departDate) &&
          value.returnDate < value.departDate
        ) {
          issue("returnDate", "Return date cannot be before departure");
        }
      }
      if (value.adults + value.children > MAX_SEATED_PAX) {
        issue("children", "Adults and children together are at most 9");
      }
      if (value.infants > value.adults) {
        issue("infants", "Each infant needs one adult");
      }
    })
    .transform((value) => ({
      ...value,
      returnDate:
        value.tripType === "ROUND_TRIP" ? value.returnDate : undefined,
    }));
}

export type CreateSearchInput = z.infer<ReturnType<typeof createSearchSchema>>;
