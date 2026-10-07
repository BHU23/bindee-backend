import { z } from "zod";

export const SEAT_NO_PATTERN = /^(\d{1,2})([A-F])$/;

const segment = z.object({
  flightId: z.string().min(1),
  fareFamily: z.enum(["LITE", "VALUE", "FLEX"]),
  seats: z
    .array(
      z.object({
        paxIndex: z.number().int().min(0),
        seatNo: z.string().regex(SEAT_NO_PATTERN),
      }),
    )
    .optional(),
});

export const holdRequestSchema = z
  .object({
    bookingRef: z.string().min(1),
    segments: z.array(segment).min(1),
    paxCount: z.number().int().min(1).max(9),
    ttlSeconds: z.number().int().min(1).max(3600),
  })
  .refine(
    (r) => r.segments.every((s) => (s.seats?.length ?? 0) <= r.paxCount),
    {
      message: "More seats than passengers",
    },
  );
