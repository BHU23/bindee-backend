export const EVENT_NAMES = [
  "BookingCreated",
  "SeatsHeld",
  "SeatHoldFailed",
  "HoldExpired",
  "PaymentMethodSelected",
  "PaymentPending",
  "PaymentCompleted",
  "PaymentFailed",
  "PaidAfterHoldExpired",
  "TicketIssued",
  "TicketingFailed",
  "ConfirmationSent",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

// TODO(booking, payment, ticketing specs): `payload` is untyped on purpose because this spec only
// defines the event names. When each spec implements its events, replace `Record<string, unknown>`
// with a payload map keyed by event name (e.g. `EventPayloads[N]`, a discriminated union of
// `{ name, payload }`) and validate incoming jobs with Zod in BullmqEventBus before calling handlers.
// Owners: booking -> BookingCreated, SeatsHeld, SeatHoldFailed, HoldExpired;
// payment -> PaymentPending, PaymentCompleted, PaymentFailed, PaidAfterHoldExpired;
// ticketing -> TicketIssued, TicketingFailed, ConfirmationSent.
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
