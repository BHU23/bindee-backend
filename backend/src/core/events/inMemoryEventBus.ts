import { type Clock, systemClock } from "../utils/clock.js";
import {
  DEFAULT_RETRY,
  type DomainEvent,
  type EventBus,
  type EventHandler,
  type EventName,
  type RetryOptions,
} from "./eventBus.js";

export interface FailedDelivery {
  event: DomainEvent;
  error: unknown;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<EventName, EventHandler[]>();
  private readonly failed: FailedDelivery[] = [];
  private readonly retry: RetryOptions;
  private readonly clock: Clock;

  constructor(options: { clock?: Clock; retry?: Partial<RetryOptions> } = {}) {
    this.clock = options.clock ?? systemClock;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
  }

  subscribe(name: EventName, handler: EventHandler): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.name) ?? [];
    await Promise.all(
      handlers.map((handler) => this.deliver(handler, event, 1)),
    );
  }

  getFailed(): readonly FailedDelivery[] {
    return this.failed;
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }

  private async deliver(
    handler: EventHandler,
    event: DomainEvent,
    attempt: number,
  ): Promise<void> {
    try {
      await handler(event);
    } catch (error) {
      if (attempt >= this.retry.attempts) {
        this.failed.push({ event, error });
        return;
      }
      const delay = this.retry.backoffMs * 2 ** (attempt - 1);
      this.clock.setTimeout(
        () => void this.deliver(handler, event, attempt + 1),
        delay,
      );
    }
  }
}
