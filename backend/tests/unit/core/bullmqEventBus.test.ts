import { beforeEach, describe, expect, it, vi } from "vitest";

const queueAdd = vi.fn(async () => undefined);
const queueClose = vi.fn(async () => undefined);
const getFailed = vi.fn(async () => []);
const workerClose = vi.fn(async () => undefined);
const workers: {
  name: string;
  processor: (job: { data: unknown }) => Promise<void>;
}[] = [];

vi.mock("bullmq", () => ({
  Queue: vi.fn(function (this: object) {
    Object.assign(this, { add: queueAdd, close: queueClose, getFailed });
  }),
  Worker: vi.fn(function (
    this: object,
    name: string,
    processor: (job: { data: unknown }) => Promise<void>,
  ) {
    workers.push({ name, processor });
    Object.assign(this, { close: workerClose });
  }),
}));

const { BullmqEventBus } =
  await import("../../../src/core/events/bullmqEventBus.js");

const event = {
  name: "PaymentCompleted" as const,
  payload: { bookingId: "b1" },
};

describe("BullmqEventBus (bullmq mocked; real Redis behaviour NOT VERIFIED in CI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workers.length = 0;
  });

  describe("AC-FND-05 BullMQ options", () => {
    it("When publishing, should add a job to domain-events with attempts, exponential backoff and removeOnFail false", async () => {
      const bus = new BullmqEventBus(
        { host: "x" },
        { attempts: 4, backoffMs: 500 },
      );
      await bus.publish(event);
      expect(queueAdd).toHaveBeenCalledWith("PaymentCompleted", event, {
        attempts: 4,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    });
  });

  it("When subscribing twice, should create one worker on domain-events that runs all handlers for the event", async () => {
    const bus = new BullmqEventBus({ host: "x" });
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    bus.subscribe("PaymentCompleted", a);
    bus.subscribe("PaymentCompleted", b);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.name).toBe("domain-events");
    await workers[0]?.processor({ data: event });
    await workers[0]?.processor({
      data: { name: "TicketIssued", payload: {} },
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("When asking for dead letters, should read the failed set", async () => {
    const bus = new BullmqEventBus({ host: "x" });
    await bus.getFailed();
    expect(getFailed).toHaveBeenCalled();
  });

  it("When closing, should close the worker and the queue", async () => {
    const bus = new BullmqEventBus({ host: "x" });
    bus.subscribe("PaymentCompleted", async () => undefined);
    await bus.close();
    expect(workerClose).toHaveBeenCalled();
    expect(queueClose).toHaveBeenCalled();
  });
});
