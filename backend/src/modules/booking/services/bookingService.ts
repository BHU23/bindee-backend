import type { PrismaClient } from "@/database/generated/client.js";
import type { Clock } from "@/core/utils/clock.js";
import { validate } from "@/core/utils/validate.js";
import {
  NotFoundError,
  PriceChangedError,
  SearchExpiredError,
  ValidationError,
} from "@/core/errors/index.js";
import type { InventoryPort } from "@/modules/inventory/index.js";
import { createBookingDraftRepository } from "../repositories/bookingDraftRepository.js";
import type {
  BookingDraftRecord,
  CreateDraftResponse,
  SelectFareResponse,
} from "../types/bookingDraft.js";
import {
  createDraftSchema,
  draftParamsSchema,
  selectFareSchema,
} from "../validators/bookingDraft.js";
import { selectFareView } from "../views/bookingView.js";

/** A draft lives as long as its search; Confirm booking (review-hold) sets confirmedAt to stop that. */
export const DRAFT_TTL_MS = 20 * 60 * 1000;

export interface BookingService {
  createDraft(body: unknown, sessionId?: string): Promise<CreateDraftResponse>;
  selectOutbound(
    params: unknown,
    body: unknown,
    sessionId?: string,
  ): Promise<SelectFareResponse>;
}

export interface BookingServiceDeps {
  prisma: PrismaClient;
  clock: Clock;
  inventory: InventoryPort;
}

function requireSession(sessionId: string | undefined): string {
  if (sessionId === undefined) {
    throw new ValidationError("X-Session-Id header is required");
  }
  return sessionId;
}

export function createBookingService(deps: BookingServiceDeps): BookingService {
  const { prisma, clock, inventory } = deps;
  const drafts = createBookingDraftRepository(prisma);

  async function loadDraft(
    params: unknown,
    sessionId: string,
  ): Promise<BookingDraftRecord> {
    const { draftId } = validate(draftParamsSchema, params);
    const draft = await drafts.findForSession(draftId, sessionId);
    if (!draft) {
      throw new NotFoundError("DRAFT_NOT_FOUND", "Booking draft not found");
    }
    const isExpired =
      draft.confirmedAt === null &&
      clock.now() >= draft.searchedAt.getTime() + DRAFT_TTL_MS;
    if (isExpired) {
      throw new SearchExpiredError();
    }
    return draft;
  }

  return {
    async createDraft(body, sessionId) {
      const session = requireSession(sessionId);
      const { searchId } = validate(createDraftSchema, body);
      const search = await inventory.getSearch({
        searchId,
        sessionId: session,
      });
      const id = await drafts.create({
        sessionId: session,
        searchId,
        tripType: search.query.tripType,
        adults: search.query.adults,
        children: search.query.children,
        infants: search.query.infants,
        searchedAt: new Date(search.searchedAt),
        createdAt: new Date(clock.now()),
      });
      return { draftId: id };
    },

    async selectOutbound(params, body, sessionId) {
      const session = requireSession(sessionId);
      const draft = await loadDraft(params, session);
      const { flightId, fareFamily } = validate(selectFareSchema, body);
      const paxCounts = {
        adults: draft.adults,
        children: draft.children,
        infants: draft.infants,
      };
      const repriced = await inventory.reprice({
        searchId: draft.searchId,
        flightId,
        fareFamily,
        paxCounts,
      });
      if (repriced.changed) {
        throw new PriceChangedError({
          oldPrice: repriced.oldPrice,
          newPrice: repriced.newPrice,
          reason: repriced.reason ?? "PRICE_UPDATED",
        });
      }
      const search = await inventory.getSearch({
        searchId: draft.searchId,
        sessionId: session,
      });
      const flight = search.outbound.find((f) => f.flightId === flightId);
      if (!flight) {
        throw new NotFoundError("FLIGHT_NOT_FOUND", "Flight not found");
      }
      await drafts.saveOutbound(draft.id, {
        flightId,
        fareFamily,
        price: repriced.newPrice,
        arriveAt: new Date(flight.arriveAt),
      });
      return selectFareView(flightId, fareFamily, repriced);
    },
  };
}
