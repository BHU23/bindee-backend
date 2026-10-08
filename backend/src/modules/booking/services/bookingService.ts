import type { PrismaClient } from "@/database/generated/client.js";
import type { Clock } from "@/core/utils/clock.js";
import { validate } from "@/core/utils/validate.js";
import {
  ConflictError,
  NotFoundError,
  PriceChangedError,
  SearchExpiredError,
  ValidationError,
} from "@/core/errors/index.js";
import type {
  FareFamily,
  FlightOption,
  InventoryPort,
  RepriceResult,
  StoredSearch,
} from "@/modules/inventory/index.js";
import { createBookingDraftRepository } from "../repositories/bookingDraftRepository.js";
import type {
  BookingDraftRecord,
  BookingLeg,
  CreateDraftResponse,
  FaresResponse,
  SelectFareResponse,
} from "../types/bookingDraft.js";
import {
  acceptPriceSchema,
  createDraftSchema,
  draftParamsSchema,
  faresParamsSchema,
  selectFareSchema,
} from "../validators/bookingDraft.js";
import {
  faresView,
  flightSummaryView,
  selectFareView,
} from "../views/bookingView.js";

/** A draft lives as long as its search; Confirm booking (review-hold) sets confirmedAt to stop that. */
export const DRAFT_TTL_MS = 20 * 60 * 1000;
const ALTERNATIVES_DAY_WINDOW = 1;

export interface BookingService {
  createDraft(body: unknown, sessionId?: string): Promise<CreateDraftResponse>;
  getFares(params: unknown, sessionId?: string): Promise<FaresResponse>;
  selectFare(
    leg: BookingLeg,
    params: unknown,
    body: unknown,
    sessionId?: string,
  ): Promise<SelectFareResponse>;
  acceptPrice(
    leg: BookingLeg,
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

function findFlight(
  search: StoredSearch,
  leg: BookingLeg,
  flightId: string,
): FlightOption {
  const flights = leg === "outbound" ? search.outbound : (search.inbound ?? []);
  const flight = flights.find((f) => f.flightId === flightId);
  if (!flight) {
    throw new NotFoundError("FLIGHT_NOT_FOUND", "Flight not found");
  }
  return flight;
}

export function createBookingService(deps: BookingServiceDeps): BookingService {
  const { prisma, clock, inventory } = deps;
  const drafts = createBookingDraftRepository(prisma);

  async function loadDraft(
    draftId: string,
    sessionId: string,
  ): Promise<BookingDraftRecord> {
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

  function reprice(
    draft: BookingDraftRecord,
    flightId: string,
    fareFamily: FareFamily,
  ): Promise<RepriceResult> {
    return inventory.reprice({
      searchId: draft.searchId,
      flightId,
      fareFamily,
      paxCounts: {
        adults: draft.adults,
        children: draft.children,
        infants: draft.infants,
      },
    });
  }

  async function alternativesFor(draft: BookingDraftRecord, flightId: string) {
    const options = await inventory.findAlternatives({
      flightId,
      paxCount: draft.adults + draft.children,
      dayWindow: ALTERNATIVES_DAY_WINDOW,
    });
    return options.map(flightSummaryView);
  }

  async function priceChanged(
    draft: BookingDraftRecord,
    flightId: string,
    oldPrice: number,
    repriced: RepriceResult,
  ): Promise<PriceChangedError> {
    const reason = repriced.reason ?? "PRICE_UPDATED";
    return new PriceChangedError(
      { oldPrice, newPrice: repriced.newPrice, reason },
      reason === "FARE_SOLD_OUT"
        ? { alternatives: await alternativesFor(draft, flightId) }
        : {},
    );
  }

  async function saveLeg(
    draft: BookingDraftRecord,
    leg: BookingLeg,
    session: string,
    flightId: string,
    fareFamily: FareFamily,
    repriced: RepriceResult,
  ): Promise<SelectFareResponse> {
    const search = await inventory.getSearch({
      searchId: draft.searchId,
      sessionId: session,
    });
    const flight = findFlight(search, leg, flightId);
    await drafts.saveSelection(draft.id, leg, {
      flightId,
      fareFamily,
      price: repriced.newPrice,
      ...(leg === "outbound" ? { arriveAt: new Date(flight.arriveAt) } : {}),
    });
    return selectFareView(flightId, fareFamily, repriced);
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

    async getFares(params, sessionId) {
      const session = requireSession(sessionId);
      const { draftId, flightId } = validate(faresParamsSchema, params);
      const draft = await loadDraft(draftId, session);
      const search = await inventory.getSearch({
        searchId: draft.searchId,
        sessionId: session,
      });
      const inOutbound = search.outbound.some((f) => f.flightId === flightId);
      return faresView(
        findFlight(search, inOutbound ? "outbound" : "return", flightId),
      );
    },

    async selectFare(leg, params, body, sessionId) {
      const session = requireSession(sessionId);
      const { draftId } = validate(draftParamsSchema, params);
      const draft = await loadDraft(draftId, session);
      const { flightId, fareFamily } = validate(selectFareSchema, body);
      const repriced = await reprice(draft, flightId, fareFamily);
      if (repriced.changed) {
        await drafts.savePending(draft.id, leg, { flightId, fareFamily });
        throw await priceChanged(draft, flightId, repriced.oldPrice, repriced);
      }
      return saveLeg(draft, leg, session, flightId, fareFamily, repriced);
    },

    async acceptPrice(leg, params, body, sessionId) {
      const session = requireSession(sessionId);
      const { draftId } = validate(draftParamsSchema, params);
      const draft = await loadDraft(draftId, session);
      const { newPrice } = validate(acceptPriceSchema, body);
      const pending = draft[leg].pending;
      if (!pending) {
        throw new ConflictError(
          "NO_PENDING_SELECTION",
          "There is no price change waiting for a decision",
        );
      }
      const { flightId, fareFamily } = pending;
      const repriced = await reprice(draft, flightId, fareFamily);
      if (
        repriced.reason === "FARE_SOLD_OUT" ||
        repriced.newPrice !== newPrice
      ) {
        throw await priceChanged(draft, flightId, newPrice, repriced);
      }
      return saveLeg(draft, leg, session, flightId, fareFamily, repriced);
    },
  };
}
