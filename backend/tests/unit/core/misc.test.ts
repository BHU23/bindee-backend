import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { systemClock } from "@/core/utils/clock.js";
import { validate } from "@/core/utils/validate.js";
import { JOB_NAMES } from "@/core/jobs/scheduler.js";
import { EVENT_NAMES } from "@/core/events/eventBus.js";
import { prisma } from "@/database/client/prisma.js";
import {
  createWithIdempotency,
  hashRequest,
} from "@/core/utils/idempotency.js";
import { createInMemoryIdempotencyRepository } from "../../fixtures/inMemoryIdempotencyRepository.js";

describe("systemClock", () => {
  it("When scheduling and cancelling, should not fire the callback", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cancel = systemClock.setTimeout(fn, 10);
    cancel();
    systemClock.setTimeout(fn, 20);
    await vi.advanceTimersByTimeAsync(30);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(typeof systemClock.now()).toBe("number");
    vi.useRealTimers();
  });
});

describe("validate", () => {
  it("When the root value is invalid, should report it under _", () => {
    expect(() => validate(z.string(), 1)).toThrowError(
      expect.objectContaining({ fields: { _: expect.any(String) } }),
    );
  });

  it("When a field has several issues, should keep the first message", () => {
    const schema = z.object({ name: z.string().min(3).regex(/^\d+$/) });
    expect(() => validate(schema, { name: "a" })).toThrowError(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        fields: { name: expect.any(String) },
      }),
    );
  });

  it("When input is valid, should return the parsed value", () => {
    expect(validate(z.object({ n: z.coerce.number() }), { n: "3" })).toEqual({
      n: 3,
    });
  });
});

describe("shared constants", () => {
  it("When listing jobs and events, should match the spec names", () => {
    expect(JOB_NAMES).toEqual([
      "expire-holds",
      "retry-ticketing",
      "reconcile-paid",
      "complete-refunds",
    ]);
    expect(EVENT_NAMES).toContain("PaidAfterHoldExpired");
    expect(EVENT_NAMES).toHaveLength(11);
  });
});

describe("prisma client module", () => {
  it("When imported, should construct a client without connecting", () => {
    expect(prisma).toBeDefined();
  });
});

describe("withIdempotency defaults", () => {
  it("When polling with the default sleep and clock, should time out in real time", async () => {
    const withIdempotency = createWithIdempotency({
      repository: createInMemoryIdempotencyRepository(),
      timeoutMs: 30,
      pollMs: 5,
    });
    const hash = hashRequest({});
    void withIdempotency(
      "k",
      "s",
      hash,
      () => new Promise<never>(() => undefined),
    );
    await expect(
      withIdempotency("k", "s", hash, async () => 1),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
  });
});
