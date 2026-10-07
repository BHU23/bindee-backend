import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  type BookingStatus,
} from "@/modules/booking/index.js";
import {
  canTransition,
  transition,
} from "@/modules/booking/services/bookingStateMachine.js";

const LEGAL: [BookingStatus, BookingStatus][] = [
  ["DRAFT", "PENDING_PAYMENT"],
  ["PENDING_PAYMENT", "PAID"],
  ["PAID", "TICKETED"],
  ["DRAFT", "SEAT_HOLD_FAILED"],
  ["PENDING_PAYMENT", "HOLD_EXPIRED"],
  ["PENDING_PAYMENT", "PAYMENT_FAILED"],
  ["PAYMENT_FAILED", "PENDING_PAYMENT"],
  ["PAID", "TICKETING_FAILED"],
  ["TICKETING_FAILED", "PAID"],
  ["TICKETING_FAILED", "TICKETED"],
];

function legalKey(from: string, to: string): string {
  return `${from}->${to}`;
}
const legal = new Set(LEGAL.map(([from, to]) => legalKey(from, to)));
const allPairs = BOOKING_STATUSES.flatMap((from) =>
  BOOKING_STATUSES.map((to) => [from, to] as const),
);
const illegalPairs = allPairs.filter(
  ([from, to]) => !legal.has(legalKey(from, to)),
);

describe("booking state machine", () => {
  describe("AC-FND-07 legal transitions", () => {
    it.each(LEGAL)("When moving %s to %s, should be allowed", (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(transition(from, to)).toBe(to);
    });
  });

  describe("AC-FND-07 every other pair", () => {
    it("When enumerating all status pairs, should cover every status twice over", () => {
      expect(allPairs).toHaveLength(BOOKING_STATUSES.length ** 2);
      expect(illegalPairs.length + LEGAL.length).toBe(allPairs.length);
    });

    it.each(illegalPairs)(
      "When moving %s to %s, should reject with INVALID_STATE_TRANSITION",
      (from, to) => {
        expect(canTransition(from, to)).toBe(false);
        expect(() => transition(from, to)).toThrowError(
          expect.objectContaining({
            status: 409,
            code: "INVALID_STATE_TRANSITION",
          }),
        );
      },
    );
  });
});
