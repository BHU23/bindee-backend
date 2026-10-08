import { z } from "zod";
import { DEPARTURE_BANDS } from "../services/departureBands.js";

const FARE_FAMILIES = ["LITE", "VALUE", "FLEX"] as const;

/** An empty value (`?minPrice=`) means "not set". */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

function list<const T extends string>(values: readonly T[]) {
  return optional(
    z
      .string()
      .refine(
        (value) => value.split(",").every((item) => values.includes(item as T)),
        `Use a comma-separated list of: ${values.join(", ")}`,
      )
      .transform((value) => value.split(",") as T[]),
  );
}

const price = optional(
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Use a non-negative number")
    .transform(Number),
);

/** Query string of GET /searches/:searchId/flights. */
export const flightListQuerySchema = z
  .object({
    leg: optional(z.enum(["outbound", "return"])),
    departure: list(DEPARTURE_BANDS),
    directOnly: optional(
      z.enum(["true", "false"]).transform((v) => v === "true"),
    ),
    minPrice: price,
    maxPrice: price,
    fare: list(FARE_FAMILIES),
    sort: optional(z.enum(["price", "departure", "duration"])),
  })
  .superRefine((value, ctx) => {
    if (
      value.minPrice !== undefined &&
      value.maxPrice !== undefined &&
      value.minPrice > value.maxPrice
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["minPrice"],
        message: "minPrice cannot be above maxPrice",
      });
    }
  })
  .transform((value) => ({
    ...value,
    leg: value.leg ?? "outbound",
    sort: value.sort ?? "price",
  }));

export type FlightListQuery = z.infer<typeof flightListQuerySchema>;
