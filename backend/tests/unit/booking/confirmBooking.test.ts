import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/core/errors/index.js";
import { InMemoryEventBus } from "@/core/events/inMemoryEventBus.js";
import { ManualClock } from "@/core/utils/clock.js";
import type { InventoryPort } from "@/modules/inventory/index.js";
import {
  createConfirmBooking,
  MAX_PNR_ATTEMPTS,
  type ConfirmBookingDeps,
} from "@/modules/booking/services/confirmBooking.js";
import type { BookingRepository } from "@/modules/booking/repositories/bookingRepository.js";
import type { BookingDraftRecord } from "@/modules/booking/types/bookingDraft.js";

const DRAFT_ID = "0b9c7a52-1d2e-4a3b-9c4d-5e6f7a8b9c0d";
const draft: BookingDraftRecord = {
  id: DRAFT_ID,
  sessionId: "session-1",
  searchId: "search-1",
  tripType: "ONE_WAY",
  adults: 1,
  children: 0,
  infants: 0,
  searchedAt: new Date(0),
  outbound: {
    flightId: "flight-1",
    fareFamily: "LITE",
    price: 1000,
    pending: null,
  },
  outboundArriveAt: null,
  return: { flightId: null, fareFamily: null, price: null, pending: null },
  confirmedAt: null,
};
const input = {
  draftId: DRAFT_ID,
  acceptTerms: true as const,
  expectedTotal: 1000,
};

function build(
  results: Awaited<ReturnType<BookingRepository["create"]>>[],
  overrides: Partial<ConfirmBookingDeps> = {},
) {
  const create = vi.fn<BookingRepository["create"]>();
  for (const result of results) create.mockResolvedValueOnce(result);
  const inventory = {
    reprice: vi.fn(async () => ({
      changed: false,
      oldPrice: 1000,
      newPrice: 1000,
      perPax: { adult: 1000, child: 0, infant: 0 },
    })),
    holdSeats: vi.fn(async () => ({
      holdId: "hold-1",
      expiresAt: new Date(900_000),
    })),
    releaseSeats: vi.fn(async () => undefined),
  } as unknown as InventoryPort;
  const draws = vi.fn<(max: number) => number>().mockReturnValue(0);
  const confirm = createConfirmBooking({
    clock: new ManualClock(),
    inventory,
    eventBus: new InMemoryEventBus(),
    withIdempotency: (_k, _s, _h, fn) => fn(),
    loadDraft: async () => draft,
    passengers: {
      replacePassengers: vi.fn(),
      findByDraft: async () => ({
        passengers: [
          {
            type: "adult",
            title: "Mr",
            firstName: "A",
            middleName: null,
            lastName: "B",
            dob: "1990-01-01",
            gender: "M",
            nationality: "TH",
            passportNo: null,
            passportCountry: null,
            passportExpiry: null,
            infantOfPaxIndex: null,
          },
        ],
        contact: { name: "A B", email: "a@b.co", phone: "+66812345678" },
        consent: { privacy: true, marketing: false },
      }),
    },
    bookings: { create },
    randomInt: draws,
    ...overrides,
  });
  return { confirm, create, inventory, draws };
}

describe("confirmBooking PNR generation", () => {
  it("AC-RH-12: When the PNR already exists, should draw a new one and retry the insert", async () => {
    const { confirm, create, draws } = build([
      { kind: "pnr_taken" },
      { kind: "pnr_taken" },
      { kind: "created" },
    ]);
    draws.mockReturnValueOnce(1).mockReturnValue(2);

    const res = await confirm("key", input, "session-1");

    expect(res.pnr).toHaveLength(6);
    expect(create).toHaveBeenCalledTimes(3);
    const pnrs = create.mock.calls.map(([row]) => row.pnr);
    expect(new Set(pnrs).size).toBe(2); // first draw differs from the later draws
  });

  it("AC-RH-12: When all 5 attempts collide, should fail with 500 PNR_GENERATION_FAILED and release the hold", async () => {
    const taken = Array.from({ length: MAX_PNR_ATTEMPTS }, () => ({
      kind: "pnr_taken" as const,
    }));
    const { confirm, create, inventory } = build(taken);

    const error = await confirm("key", input, "session-1").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 500, code: "PNR_GENERATION_FAILED" });
    expect(create).toHaveBeenCalledTimes(5);
    expect(inventory.releaseSeats).toHaveBeenCalledWith("hold-1");
  });

  it("When the insert fails unexpectedly, should release the hold and rethrow", async () => {
    const { confirm, create, inventory } = build([]);
    create.mockRejectedValueOnce(new Error("db down"));

    await expect(confirm("key", input, "session-1")).rejects.toThrow("db down");
    expect(inventory.releaseSeats).toHaveBeenCalledWith("hold-1");
  });

  it("When releasing the hold fails too, should still report the original error", async () => {
    const { confirm, create, inventory } = build([]);
    create.mockRejectedValueOnce(new Error("db down"));
    vi.mocked(inventory.releaseSeats).mockRejectedValueOnce(
      new Error("release failed"),
    );

    await expect(confirm("key", input, "session-1")).rejects.toThrow("db down");
  });

  it("When another request booked the draft meanwhile, should respond 409 DRAFT_ALREADY_BOOKED and release the hold", async () => {
    const { confirm, inventory } = build([{ kind: "draft_taken" }]);

    await expect(confirm("key", input, "session-1")).rejects.toMatchObject({
      status: 409,
      code: "DRAFT_ALREADY_BOOKED",
    });
    expect(inventory.releaseSeats).toHaveBeenCalledWith("hold-1");
  });
});
