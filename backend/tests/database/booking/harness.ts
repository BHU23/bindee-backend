import { vi } from "vitest";
import { buildApp } from "@/app.js";
import { ManualClock } from "@/core/utils/clock.js";
import { createBookingService } from "@/modules/booking/index.js";
import {
  createPrismaInventory,
  type InventoryPort,
} from "@/modules/inventory/index.js";
import { createSearchService } from "@/modules/search/index.js";
import { SEED_NOW, createTestPrisma } from "../testDb.js";

export const prisma = createTestPrisma();
export const SESSION_A = "0b9c7a52-1d2e-4a3b-9c4d-5e6f7a8b9c0d";
export const SESSION_B = "6f1d3c8e-2a4b-4c5d-8e9f-0a1b2c3d4e5f";
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

export async function setup(override: Partial<InventoryPort> = {}) {
  const clock = new ManualClock();
  await clock.advance(SEED_NOW.getTime());
  const base = createPrismaInventory({ prisma, clock });
  const inventory: InventoryPort = {
    ...base,
    reprice: vi.fn(base.reprice),
    ...override,
  };
  const searchService = createSearchService({ prisma, clock, inventory });
  const bookingService = createBookingService({ prisma, clock, inventory });
  const app = await buildApp(
    { logger: false },
    { searchService, bookingService },
  );

  async function createSearch(session = SESSION_A): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/searches",
      headers: { "x-session-id": session },
      payload: {
        tripType: "ONE_WAY",
        origin: "BKK",
        destination: "HKT",
        departDate: "2026-10-08",
        adults: 1,
      },
    });
    return res.json().searchId as string;
  }
  function createDraft(payload: unknown, session: string | null = SESSION_A) {
    return app.inject({
      method: "POST",
      url: "/api/v1/booking-drafts",
      headers: session ? { "x-session-id": session } : {},
      payload: payload as object,
    });
  }
  function putOutbound(
    draftId: string,
    payload: unknown,
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method: "PUT",
      url: `/api/v1/booking-drafts/${draftId}/outbound`,
      headers: session ? { "x-session-id": session } : {},
      payload: payload as object,
    });
  }
  async function firstFlightId(searchId: string): Promise<string> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/searches/${searchId}/flights`,
      headers: { "x-session-id": SESSION_A },
    });
    return res.json().flights[0].flightId as string;
  }
  function send(
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    session: string | null = SESSION_A,
  ) {
    return app.inject({
      method,
      url: `/api/v1/booking-drafts${url}`,
      headers: session ? { "x-session-id": session } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }
  /** A draft on a fresh ONE_WAY search plus the id of its first outbound flight. */
  async function draftWithFlight() {
    const searchId = await createSearch();
    const { draftId } = (await createDraft({ searchId })).json();
    const flightId = await firstFlightId(searchId);
    return { searchId, draftId, flightId };
  }
  return {
    clock,
    inventory,
    createSearch,
    createDraft,
    putOutbound,
    firstFlightId,
    send,
    draftWithFlight,
  };
}
