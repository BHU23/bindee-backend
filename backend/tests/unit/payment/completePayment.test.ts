import { describe, expect, it, vi } from "vitest";
import { InvalidStateTransitionError } from "@/core/errors/index.js";
import { InMemoryEventBus } from "@/core/events/inMemoryEventBus.js";
import { ManualClock } from "@/core/utils/clock.js";
import type { PaymentRepository } from "@/modules/payment/repositories/paymentRepository.js";
import { createCompletePayment } from "@/modules/payment/services/completePayment.js";
import type { PaymentForSettlement } from "@/modules/payment/types/payment.js";

function payment(
  booking: Partial<PaymentForSettlement["booking"]> = {},
): PaymentForSettlement {
  return {
    id: "pay-1",
    bookingId: "book-1",
    method: "CARD",
    status: "PENDING",
    amount: 900,
    mockRef: "MOCK-20261007-AAAAAA",
    failureCode: null,
    pendingEvent: null,
    booking: {
      pnr: "ABC123",
      sessionId: "s",
      status: "PENDING_PAYMENT",
      total: 900,
      holdExpiresAt: new Date(10 * 60_000),
      ...booking,
    },
  };
}

function setup(repo: Partial<PaymentRepository>) {
  const clock = new ManualClock();
  const payments = {
    findForSettlement: vi.fn(),
    settle: vi.fn(),
    claimPendingEvent: vi.fn().mockResolvedValue(null),
    restorePendingEvent: vi.fn(),
    ...repo,
  } as unknown as PaymentRepository;
  const eventBus = new InMemoryEventBus({ clock });
  const complete = createCompletePayment({
    payments,
    eventBus,
    clock,
    holdGraceSeconds: 60,
  });
  return { complete, payments };
}
const input = {
  paymentId: "pay-1",
  result: "SUCCESS",
  mockRef: "MOCK-20261007-AAAAAA",
} as const;

describe("completePayment", () => {
  it("AC-MP-02: When the booking moves between the read and the settle, should read again and settle on fresh data", async () => {
    const findForSettlement = vi
      .fn()
      .mockResolvedValueOnce(payment())
      .mockResolvedValue({ ...payment({ status: "HOLD_EXPIRED" }) });
    const settle = vi
      .fn()
      .mockRejectedValueOnce(
        new InvalidStateTransitionError("PENDING_PAYMENT", "PAID"),
      )
      .mockResolvedValue(true);
    const { complete } = setup({ findForSettlement, settle });

    const result = await complete(input);

    expect(result).toEqual({ paymentId: "pay-1", status: "SUCCESS" });
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle.mock.calls[1]?.[0]).toMatchObject({
      booking: null,
      pendingEvent: "PaidAfterHoldExpired",
    });
  });

  it("When the booking keeps moving, should give up with 409 PAYMENT_BUSY instead of looping", async () => {
    const { complete, payments } = setup({
      findForSettlement: vi.fn().mockResolvedValue(payment()),
      settle: vi
        .fn()
        .mockRejectedValue(
          new InvalidStateTransitionError("PENDING_PAYMENT", "PAID"),
        ),
    });

    await expect(complete(input)).rejects.toMatchObject({
      status: 409,
      code: "PAYMENT_BUSY",
    });
    expect(payments.settle).toHaveBeenCalledTimes(3);
  });

  it("When another callback wins the race, should answer with the winner's result", async () => {
    const findForSettlement = vi
      .fn()
      .mockResolvedValueOnce(payment())
      .mockResolvedValue({
        ...payment(),
        status: "FAILED",
        failureCode: "MOCK_DECLINED",
      });
    const { complete } = setup({
      findForSettlement,
      settle: vi.fn().mockResolvedValue(false),
    });

    expect(await complete(input)).toEqual({
      paymentId: "pay-1",
      status: "FAILED",
      failureCode: "MOCK_DECLINED",
    });
  });

  it("When the publish fails, should hand the claimed event back and rethrow", async () => {
    const restorePendingEvent = vi.fn();
    const clock = new ManualClock();
    const eventBus = new InMemoryEventBus({ clock });
    vi.spyOn(eventBus, "publish").mockRejectedValue(new Error("bus down"));
    const payments = {
      findForSettlement: vi
        .fn()
        .mockResolvedValue({ ...payment(), status: "SUCCESS" }),
      claimPendingEvent: vi.fn().mockResolvedValue("PaymentCompleted"),
      restorePendingEvent,
    } as unknown as PaymentRepository;
    const complete = createCompletePayment({
      payments,
      eventBus,
      clock,
      holdGraceSeconds: 60,
    });

    await expect(complete(input)).rejects.toThrow("bus down");
    expect(restorePendingEvent).toHaveBeenCalledWith(
      "pay-1",
      "PaymentCompleted",
    );
  });
});
