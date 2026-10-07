import { createHash } from "node:crypto";
import { ConflictError } from "@/core/errors/index.js";
import { type Clock, systemClock } from "./clock.js";

export type IdempotencyStatus = "IN_PROGRESS" | "DONE";

export interface IdempotencyRecord {
  key: string;
  scope: string;
  requestHash: string;
  status: IdempotencyStatus;
  response: unknown;
  createdAt: Date;
}

/** Storage port; `tryCreate` relies on the unique (scope, key) constraint. */
export interface IdempotencyRepository {
  tryCreate(input: {
    key: string;
    scope: string;
    requestHash: string;
  }): Promise<boolean>;
  find(scope: string, key: string): Promise<IdempotencyRecord | null>;
  markDone(scope: string, key: string, response: unknown): Promise<void>;
  remove(scope: string, key: string): Promise<void>;
}

export type WithIdempotency = <T>(
  key: string,
  scope: string,
  requestHash: string,
  fn: () => Promise<T>,
) => Promise<T>;

export interface IdempotencyOptions {
  repository: IdempotencyRepository;
  timeoutMs?: number;
  pollMs?: number;
  clock?: Clock;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 100;

export function hashRequest(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function createWithIdempotency(
  options: IdempotencyOptions,
): WithIdempotency {
  const { repository } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const clock = options.clock ?? systemClock;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async function withIdempotency<T>(
    key: string,
    scope: string,
    requestHash: string,
    fn: () => Promise<T>,
  ) {
    const startedAt = clock.now();
    for (;;) {
      if (await repository.tryCreate({ key, scope, requestHash })) {
        return runFirst(key, scope, fn);
      }
      const record = await repository.find(scope, key);
      if (!record) continue; // the first request failed and released the key
      if (record.requestHash !== requestHash) {
        throw new ConflictError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request",
        );
      }
      if (record.status === "DONE") return record.response as T;
      if (clock.now() - startedAt >= timeoutMs) {
        throw new ConflictError(
          "IDEMPOTENCY_IN_PROGRESS",
          "A request with this Idempotency-Key is still in progress",
        );
      }
      await sleep(pollMs);
    }
  };

  async function runFirst<T>(
    key: string,
    scope: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      const response = await fn();
      await repository.markDone(scope, key, response);
      return response;
    } catch (error) {
      await repository.remove(scope, key); // a failed attempt may be retried with the same key
      throw error;
    }
  }
}
