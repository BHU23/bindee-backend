import { Queue, Worker, type ConnectionOptions } from "bullmq";
import {
  DEFAULT_RETRY,
  type DomainEvent,
  type EventBus,
  type EventHandler,
  type EventName,
  type RetryOptions,
} from "./eventBus.js";

export const DOMAIN_EVENTS_QUEUE = "domain-events";

export class BullmqEventBus implements EventBus {
  private readonly queue: Queue;
  private readonly handlers = new Map<EventName, EventHandler[]>();
  private readonly retry: RetryOptions;
  private worker: Worker | undefined;

  constructor(
    private readonly connection: ConnectionOptions,
    retry: Partial<RetryOptions> = {},
  ) {
    this.retry = { ...DEFAULT_RETRY, ...retry };
    this.queue = new Queue(DOMAIN_EVENTS_QUEUE, { connection });
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.queue.add(event.name, event, {
      attempts: this.retry.attempts,
      backoff: { type: "exponential", delay: this.retry.backoffMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  subscribe(name: EventName, handler: EventHandler): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    this.worker ??= new Worker(
      DOMAIN_EVENTS_QUEUE,
      (job) => this.dispatch(job.data as DomainEvent),
      {
        connection: this.connection,
      },
    );
  }

  /** Dead-letter: jobs that exhausted their attempts stay in BullMQ's failed set. */
  getFailed() {
    return this.queue.getFailed();
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers.get(event.name) ?? []) {
      await handler(event);
    }
  }
}
