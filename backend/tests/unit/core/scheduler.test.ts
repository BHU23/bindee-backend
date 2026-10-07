import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "@/core/utils/clock.js";
import { InMemoryScheduler } from "@/core/jobs/inMemoryScheduler.js";

describe("InMemoryScheduler", () => {
  describe("AC-FND-06 repeatable job", () => {
    it("When the clock ticks, should run expire-holds once per interval", async () => {
      const clock = new ManualClock();
      const scheduler = new InMemoryScheduler(clock);
      const job = vi.fn(async () => undefined);
      await scheduler.registerJob("expire-holds", 1000, job);
      await clock.advance(999);
      expect(job).not.toHaveBeenCalled();
      await clock.advance(1);
      expect(job).toHaveBeenCalledTimes(1);
      await clock.advance(3000);
      expect(job).toHaveBeenCalledTimes(4);
    });

    it("When the app restarts and re-registers the job, should not duplicate runs", async () => {
      const clock = new ManualClock();
      const scheduler = new InMemoryScheduler(clock);
      const job = vi.fn(async () => undefined);
      await scheduler.registerJob("expire-holds", 1000, job);
      await scheduler.registerJob("expire-holds", 1000, job);
      await clock.advance(2000);
      expect(job).toHaveBeenCalledTimes(2);
    });

    it("When a run is still in progress at the next tick, should skip it (one instance at a time)", async () => {
      const clock = new ManualClock();
      const scheduler = new InMemoryScheduler(clock);
      let finish!: () => void;
      const job = vi.fn(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      await scheduler.registerJob("retry-ticketing", 1000, job);
      await clock.advance(2000);
      expect(job).toHaveBeenCalledTimes(1);
      finish();
      await new Promise((resolve) => setImmediate(resolve));
      await clock.advance(1000);
      expect(job).toHaveBeenCalledTimes(2);
    });

    it("When a run throws, should keep scheduling", async () => {
      const clock = new ManualClock();
      const scheduler = new InMemoryScheduler(clock);
      const job = vi
        .fn()
        .mockRejectedValueOnce(new Error("x"))
        .mockResolvedValue(undefined);
      await scheduler.registerJob("complete-refunds", 1000, job);
      await clock.advance(2000);
      expect(job).toHaveBeenCalledTimes(2);
    });

    it("When closed, should stop running jobs", async () => {
      const clock = new ManualClock();
      const scheduler = new InMemoryScheduler(clock);
      const job = vi.fn(async () => undefined);
      await scheduler.registerJob("expire-holds", 1000, job);
      await scheduler.close();
      await clock.advance(5000);
      expect(job).not.toHaveBeenCalled();
    });
  });

  it("When using the default system clock, should accept registration and close", async () => {
    const scheduler = new InMemoryScheduler();
    await scheduler.registerJob("expire-holds", 60_000, async () => undefined);
    await scheduler.close();
  });
});
