import { describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "@/core/events/eventBus.js";
import { InMemoryEventBus } from "@/core/events/inMemoryEventBus.js";
import {
  createReconcilePaidJob,
  type PaidBookingReader,
} from "@/modules/booking/index.js";

describe("reconcile-paid", () => {
  describe("AC-FND-10 PAID booking without tickets", () => {
    it("When run, should re-publish PaymentCompleted once per stuck booking and per run", async () => {
      const bus = new InMemoryEventBus();
      const handler = vi.fn(async (event: DomainEvent) => void event);
      bus.subscribe("PaymentCompleted", handler);
      const bookings: PaidBookingReader = {
        findPaidWithoutTickets: vi.fn(async () => [{ id: "b1" }, { id: "b2" }]),
      };
      const job = createReconcilePaidJob({ bookings, eventBus: bus });

      await job();
      expect(bookings.findPaidWithoutTickets).toHaveBeenCalledWith(60_000);
      expect(handler.mock.calls.map(([e]) => e.payload)).toEqual([
        { bookingId: "b1" },
        { bookingId: "b2" },
      ]);
    });

    it("When a ticketing handler is idempotent, should not issue a second ticket after a repeated event", async () => {
      const bus = new InMemoryEventBus();
      const issued = new Set<string>();
      bus.subscribe("PaymentCompleted", async (event) => {
        issued.add(String(event.payload["bookingId"]));
      });
      const job = createReconcilePaidJob({
        bookings: { findPaidWithoutTickets: async () => [{ id: "b1" }] },
        eventBus: bus,
      });
      await job();
      await job();
      expect([...issued]).toEqual(["b1"]);
    });

    it("When nothing is stuck, should publish nothing", async () => {
      const bus = new InMemoryEventBus();
      const publish = vi.spyOn(bus, "publish");
      await createReconcilePaidJob({
        bookings: { findPaidWithoutTickets: async () => [] },
        eventBus: bus,
      })();
      expect(publish).not.toHaveBeenCalled();
    });
  });
});
