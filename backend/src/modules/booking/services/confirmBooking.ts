import { randomInt as cryptoRandomInt } from "node:crypto";
import {
  AppError,
  ConflictError,
  PriceChangedError,
  UnprocessableError,
  ValidationError,
} from "@/core/errors/index.js";
import type { EventBus } from "@/core/events/eventBus.js";
import type { Clock } from "@/core/utils/clock.js";
import { hashRequest, type WithIdempotency } from "@/core/utils/idempotency.js";
import { validate } from "@/core/utils/validate.js";
import type {
  FareFamily,
  HoldSegment,
  InventoryPort,
} from "@/modules/inventory/index.js";
import { generatePnr } from "../models/pnr.js";
import type { BookingRepository } from "../repositories/bookingRepository.js";
import type { PassengerRepository } from "../repositories/passengerRepository.js";
import type { ConfirmBookingResponse } from "../types/booking.js";
import type { BookingDraftRecord, LegState } from "../types/bookingDraft.js";
import {
  confirmBookingSchema,
  type ConfirmBookingInput,
  idempotencyKeySchema,
} from "../validators/confirmBooking.js";
import { transition } from "./bookingStateMachine.js";

export const HOLD_TTL_SECONDS = 15 * 60;
export const MAX_PNR_ATTEMPTS = 5;
const IDEMPOTENCY_SCOPE = "create-booking";

export interface ConfirmBookingDeps {
  clock: Clock;
  inventory: InventoryPort;
  eventBus: EventBus;
  withIdempotency: WithIdempotency;
  /** Loads the session's draft; 404 when unknown, 410 when expired. */
  loadDraft(draftId: string, sessionId: string): Promise<BookingDraftRecord>;
  passengers: PassengerRepository;
  bookings: BookingRepository;
  randomInt?: (max: number) => number;
}

export type ConfirmBooking = (
  idempotencyKey: unknown,
  body: unknown,
  sessionId?: string,
) => Promise<ConfirmBookingResponse>;

interface Leg extends HoldSegment {
  fareFamily: FareFamily;
}

/** The legs the guest chose, plus the booking steps that are still missing. */
function legsOf(draft: BookingDraftRecord): {
  legs: Leg[];
  missing: Record<string, string>;
} {
  const legs: Leg[] = [];
  const missing: Record<string, string> = {};
  const wanted: [string, LegState][] = [["outbound", draft.outbound]];
  if (draft.tripType === "ROUND_TRIP") wanted.push(["return", draft.return]);
  for (const [name, leg] of wanted) {
    if (leg.flightId && leg.fareFamily && leg.price !== null) {
      legs.push({ flightId: leg.flightId, fareFamily: leg.fareFamily });
    } else {
      missing[name] = "required";
    }
  }
  return { legs, missing };
}

export function createConfirmBooking(deps: ConfirmBookingDeps): ConfirmBooking {
  const { clock, inventory, eventBus, bookings } = deps;
  const randomInt = deps.randomInt ?? cryptoRandomInt;

  async function missingSteps(
    draft: BookingDraftRecord,
  ): Promise<{ legs: Leg[]; missing: Record<string, string> }> {
    const { legs, missing } = legsOf(draft);
    const saved = await deps.passengers.findByDraft(draft.id);
    const expected = draft.adults + draft.children + draft.infants;
    if (
      saved.passengers.length !== expected ||
      saved.contact === null ||
      saved.consent === null
    ) {
      missing["passengers"] = "required";
    }
    return { legs, missing };
  }

  /** The server's own total: every leg repriced now, so a stale client total is caught. */
  async function serverTotal(
    draft: BookingDraftRecord,
    legs: Leg[],
  ): Promise<number> {
    const paxCounts = {
      adults: draft.adults,
      children: draft.children,
      infants: draft.infants,
    };
    const repriced = await Promise.all(
      legs.map((leg) =>
        inventory.reprice({
          searchId: draft.searchId,
          flightId: leg.flightId,
          fareFamily: leg.fareFamily,
          paxCounts,
        }),
      ),
    );
    return repriced.reduce((sum, r) => sum + r.newPrice, 0);
  }

  async function releaseQuietly(holdId: string): Promise<void> {
    // The hold also lapses by its own TTL, and the caller's original error matters more.
    await inventory.releaseSeats(holdId).catch(() => undefined);
  }

  /** Inserts the booking, drawing a new PNR on each collision (AC-RH-12). */
  async function insertBooking(
    draft: BookingDraftRecord,
    sessionId: string,
    total: number,
    hold: { holdId: string; expiresAt: Date },
  ): Promise<string> {
    const status = transition("DRAFT", "PENDING_PAYMENT");
    for (let attempt = 1; attempt <= MAX_PNR_ATTEMPTS; attempt++) {
      const pnr = generatePnr(randomInt);
      const result = await bookings.create({
        pnr,
        draftId: draft.id,
        sessionId,
        status,
        total,
        holdId: hold.holdId,
        holdExpiresAt: hold.expiresAt,
        createdAt: new Date(clock.now()),
      });
      if (result.kind === "created") return pnr;
      if (result.kind === "draft_taken") throw draftAlreadyBooked();
    }
    throw new AppError(
      500,
      "PNR_GENERATION_FAILED",
      "Could not generate a unique booking reference",
    );
  }

  function draftAlreadyBooked(): ConflictError {
    return new ConflictError(
      "DRAFT_ALREADY_BOOKED",
      "This booking draft has already been confirmed",
    );
  }

  async function create(
    body: ConfirmBookingInput,
    sessionId: string,
  ): Promise<ConfirmBookingResponse> {
    const draft = await deps.loadDraft(body.draftId, sessionId);
    if (draft.confirmedAt !== null) throw draftAlreadyBooked();
    const { legs, missing } = await missingSteps(draft);
    if (Object.keys(missing).length > 0) {
      throw new UnprocessableError(
        "DRAFT_INCOMPLETE",
        "Complete the missing steps before confirming",
        missing,
      );
    }
    const total = await serverTotal(draft, legs);
    if (total !== body.expectedTotal) {
      throw new PriceChangedError({
        oldPrice: body.expectedTotal,
        newPrice: total,
        reason: "PRICE_UPDATED",
      });
    }

    // bookingRef is the draft id: the PNR is only drawn after the hold, and collisions may redraw it.
    const hold = await inventory.holdSeats({
      bookingRef: draft.id,
      segments: legs,
      paxCount: draft.adults + draft.children,
      ttlSeconds: HOLD_TTL_SECONDS,
    });
    let pnr: string;
    try {
      pnr = await insertBooking(draft, sessionId, total, hold);
    } catch (error) {
      await releaseQuietly(hold.holdId);
      throw error;
    }

    const holdExpiresAt = hold.expiresAt.toISOString();
    await eventBus.publish({
      name: "BookingCreated",
      payload: { pnr, draftId: draft.id, total },
    });
    await eventBus.publish({
      name: "SeatsHeld",
      payload: { pnr, holdId: hold.holdId, holdExpiresAt },
    });
    return { pnr, status: "PENDING_PAYMENT", holdExpiresAt, total };
  }

  return async function confirmBooking(idempotencyKey, body, sessionId) {
    if (sessionId === undefined) {
      throw new ValidationError("X-Session-Id header is required");
    }
    const key = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!key.success) {
      throw new ValidationError("Idempotency-Key header is required", {
        "Idempotency-Key": "required",
      });
    }
    const parsed = validate(confirmBookingSchema, body);
    return deps.withIdempotency(
      key.data,
      `${IDEMPOTENCY_SCOPE}:${sessionId}`,
      hashRequest(parsed),
      () => create(parsed, sessionId),
    );
  };
}
