import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "../../src/core/utils/clock.js";
import {
  createWithIdempotency,
  hashRequest,
} from "../../src/core/utils/idempotency.js";
import { AppError } from "../../src/core/errors/index.js";
import { createInMemoryIdempotencyRepository } from "../fixtures/inMemoryIdempotencyRepository.js";

function setup(timeoutMs = 10_000) {
  const clock = new ManualClock();
  const withIdempotency = createWithIdempotency({
    repository: createInMemoryIdempotencyRepository(),
    clock,
    timeoutMs,
    pollMs: 100,
    sleep: async (ms) => {
      await clock.advance(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
  });
  return { withIdempotency, clock };
}

const hashA = hashRequest({ seat: "12A" });
const hashB = hashRequest({ seat: "12B" });

describe("withIdempotency", () => {
  describe("AC-FND-03 same key and payload", () => {
    it("When called twice, should return the stored response and run the side effect once", async () => {
      const { withIdempotency } = setup();
      const effect = vi.fn(async () => ({ bookingId: "b1" }));
      const first = await withIdempotency(
        "k1",
        "create-booking",
        hashA,
        effect,
      );
      const second = await withIdempotency(
        "k1",
        "create-booking",
        hashA,
        effect,
      );
      expect(second).toEqual(first);
      expect(effect).toHaveBeenCalledTimes(1);
    });

    it("When the same key is used in another scope, should run independently", async () => {
      const { withIdempotency } = setup();
      const effect = vi.fn(async () => "ok");
      await withIdempotency("k1", "scope-a", hashA, effect);
      await withIdempotency("k1", "scope-b", hashA, effect);
      expect(effect).toHaveBeenCalledTimes(2);
    });
  });

  describe("AC-FND-04 same key different payload", () => {
    it("When the payload differs, should throw 409 IDEMPOTENCY_CONFLICT", async () => {
      const { withIdempotency } = setup();
      await withIdempotency("k1", "s", hashA, async () => "ok");
      await expect(
        withIdempotency("k1", "s", hashB, async () => "ok"),
      ).rejects.toMatchObject({
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
      });
    });
  });

  describe("AC-FND-11 concurrent requests", () => {
    it("When the first is still running, should make the second wait and return the first's response", async () => {
      const { withIdempotency } = setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const effect = vi.fn(async () => {
        await gate;
        return { bookingId: "b1" };
      });
      const first = withIdempotency("k1", "s", hashA, effect);
      const second = withIdempotency("k1", "s", hashA, effect);
      await new Promise((resolve) => setImmediate(resolve));
      release();
      expect(await second).toEqual({ bookingId: "b1" });
      expect(await first).toEqual({ bookingId: "b1" });
      expect(effect).toHaveBeenCalledTimes(1);
    });

    it("When the first runs longer than the timeout, should throw 409 IDEMPOTENCY_IN_PROGRESS", async () => {
      const { withIdempotency } = setup(1_000);
      const never = new Promise<string>(() => undefined);
      void withIdempotency("k1", "s", hashA, () => never);
      const error = await withIdempotency(
        "k1",
        "s",
        hashA,
        async () => "x",
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        status: 409,
        code: "IDEMPOTENCY_IN_PROGRESS",
      });
    });
  });

  describe("when the first attempt fails", () => {
    it("When fn throws, should release the key so a retry runs again", async () => {
      const { withIdempotency } = setup();
      await expect(
        withIdempotency("k1", "s", hashA, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await expect(
        withIdempotency("k1", "s", hashA, async () => "ok"),
      ).resolves.toBe("ok");
    });

    it("When a waiter sees the failed attempt released, should run its own attempt", async () => {
      const { withIdempotency } = setup();
      let fail!: () => void;
      const gate = new Promise<void>(
        (_resolve, reject) => (fail = () => reject(new Error("boom"))),
      );
      const first = withIdempotency("k1", "s", hashA, () =>
        gate.then(() => "never"),
      );
      const second = withIdempotency("k1", "s", hashA, async () => "second");
      await new Promise((resolve) => setImmediate(resolve));
      fail();
      await expect(first).rejects.toThrow("boom");
      await expect(second).resolves.toBe("second");
    });
  });
});

describe("hashRequest", () => {
  it("When key order differs, should produce the same hash", () => {
    expect(hashRequest({ a: 1, b: [1, { c: 2, d: undefined }] })).toBe(
      hashRequest({ b: [1, { c: 2 }], a: 1 }),
    );
  });

  it("When values differ or are undefined at top level, should handle them", () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
    expect(hashRequest(undefined)).toBe(hashRequest(null));
  });
});
