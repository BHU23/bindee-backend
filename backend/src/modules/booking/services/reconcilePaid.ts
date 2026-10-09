import type { EventBus } from "@/core/events/eventBus.js";
import type { JobFn } from "@/core/jobs/scheduler.js";

export const RECONCILE_PAID_AFTER_MS = 60_000;

/** Read port implemented by the booking persistence layer (sibling spec). */
export interface PaidBookingReader {
  findPaidWithoutTickets(olderThanMs: number): Promise<{ id: string }[]>;
}

export function createReconcilePaidJob(deps: {
  bookings: PaidBookingReader;
  eventBus: EventBus;
}): JobFn {
  return async function reconcilePaid() {
    const stuck = await deps.bookings.findPaidWithoutTickets(
      RECONCILE_PAID_AFTER_MS,
    );
    for (const booking of stuck) {
      await deps.eventBus.publish({
        name: "PaymentCompleted",
        payload: { bookingId: booking.id },
      });
    }
  };
}
