export const EVENT_NAMES = [
  "BookingCreated",
  "SeatsHeld",
  "SeatHoldFailed",
  "HoldExpired",
  "PaymentPending",
  "PaymentCompleted",
  "PaymentFailed",
  "PaidAfterHoldExpired",
  "TicketIssued",
  "TicketingFailed",
  "ConfirmationSent",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export interface DomainEvent {
  name: EventName;
  payload: Record<string, unknown>;
}

/** Handlers must be idempotent: the bus delivers at least once. */
export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(name: EventName, handler: EventHandler): void;
  close(): Promise<void>;
}

export interface RetryOptions {
  attempts: number;
  backoffMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { attempts: 5, backoffMs: 1000 };
