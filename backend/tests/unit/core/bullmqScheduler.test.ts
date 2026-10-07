import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertJobScheduler = vi.fn(async () => undefined);
const queueClose = vi.fn(async () => undefined);
const workerClose = vi.fn(async () => undefined);
const workers: {
  processor: (job: { name: string }) => Promise<void>;
  options: unknown;
}[] = [];

vi.mock("bullmq", () => ({
  Queue: vi.fn(function (this: object) {
    Object.assign(this, { upsertJobScheduler, close: queueClose });
  }),
  Worker: vi.fn(function (
    this: object,
    _name: string,
    processor: (job: { name: string }) => Promise<void>,
    options: unknown,
  ) {
    workers.push({ processor, options });
    Object.assign(this, { close: workerClose });
  }),
}));

const { BullmqScheduler } =
  await import("../../../src/core/jobs/bullmqScheduler.js");

describe("BullmqScheduler (bullmq mocked; restart persistence NOT VERIFIED in CI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workers.length = 0;
  });

  describe("AC-FND-06 BullMQ registration", () => {
    it("When registering a job, should upsert a repeatable schedule with a stable id", async () => {
      const scheduler = new BullmqScheduler({ host: "x" });
      await scheduler.registerJob("expire-holds", 5000, async () => undefined);
      await scheduler.registerJob("expire-holds", 5000, async () => undefined);
      expect(upsertJobScheduler).toHaveBeenCalledTimes(2);
      expect(upsertJobScheduler).toHaveBeenCalledWith(
        "expire-holds",
        { every: 5000 },
        { name: "expire-holds" },
      );
      expect(workers).toHaveLength(1);
      expect(workers[0]?.options).toMatchObject({ concurrency: 1 });
    });
  });

  it("When the worker receives a job, should run the registered body and ignore unknown names", async () => {
    const scheduler = new BullmqScheduler({ host: "x" });
    const body = vi.fn(async () => undefined);
    await scheduler.registerJob("reconcile-paid", 1000, body);
    await workers[0]?.processor({ name: "reconcile-paid" });
    await workers[0]?.processor({ name: "unknown" });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("When closing, should close worker and queue", async () => {
    const scheduler = new BullmqScheduler({ host: "x" });
    await scheduler.registerJob("reconcile-paid", 1000, async () => undefined);
    await scheduler.close();
    expect(workerClose).toHaveBeenCalled();
    expect(queueClose).toHaveBeenCalled();
  });
});
