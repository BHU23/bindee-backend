import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "../../../src/core/utils/clock.js";
import { InMemoryEventBus } from "../../../src/core/events/inMemoryEventBus.js";
import type { DomainEvent } from "../../../src/core/events/eventBus.js";

const event: DomainEvent = {
  name: "PaymentCompleted",
  payload: { bookingId: "b1" },
};

describe("InMemoryEventBus", () => {
  let clock: ManualClock;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new ManualClock();
    bus = new InMemoryEventBus({
      clock,
      retry: { attempts: 3, backoffMs: 1000 },
    });
  });

  describe("AC-FND-05 retry with exponential backoff", () => {
    it("When a subscriber throws, should retry after 1s then 2s and stop at the configured attempts", async () => {
      const handler = vi.fn(async () => {
        throw new Error("fail");
      });
      bus.subscribe("PaymentCompleted", handler);
      await bus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);
      await clock.advance(999);
      expect(handler).toHaveBeenCalledTimes(1);
      await clock.advance(1);
      expect(handler).toHaveBeenCalledTimes(2);
      await clock.advance(1999);
      expect(handler).toHaveBeenCalledTimes(2);
      await clock.advance(1);
      expect(handler).toHaveBeenCalledTimes(3);
      await clock.advance(60_000);
      expect(handler).toHaveBeenCalledTimes(3);
      expect(bus.getFailed()).toHaveLength(1);
      expect(bus.getFailed()[0]?.event).toEqual(event);
    });

    it("When one handler keeps failing, should not block other handlers or events", async () => {
      const ok = vi.fn(async () => undefined);
      bus.subscribe("PaymentCompleted", async () => {
        throw new Error("fail");
      });
      bus.subscribe("PaymentCompleted", ok);
      bus.subscribe("TicketIssued", ok);
      await bus.publish(event);
      await bus.publish({ name: "TicketIssued", payload: {} });
      expect(ok).toHaveBeenCalledTimes(2);
    });

    it("When a retry succeeds, should not mark the event failed", async () => {
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error("once"))
        .mockResolvedValue(undefined);
      bus.subscribe("PaymentCompleted", handler);
      await bus.publish(event);
      await clock.advance(1000);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(bus.getFailed()).toHaveLength(0);
    });
  });

  describe("when there is no subscriber", () => {
    it("When publishing, should resolve without error", async () => {
      await expect(bus.publish(event)).resolves.toBeUndefined();
    });
  });

  it("When closed, should drop its subscribers", async () => {
    const handler = vi.fn(async () => undefined);
    bus.subscribe("PaymentCompleted", handler);
    await bus.close();
    await bus.publish(event);
    expect(handler).not.toHaveBeenCalled();
  });

  it("When constructed without options, should use defaults", () => {
    expect(new InMemoryEventBus()).toBeInstanceOf(InMemoryEventBus);
  });
});
