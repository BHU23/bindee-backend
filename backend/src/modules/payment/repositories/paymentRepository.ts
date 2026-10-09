import type { PrismaClient } from "@/database/generated/client.js";
import { InvalidStateTransitionError } from "@/core/errors/index.js";
import type { BookingStatus } from "@/modules/booking/index.js";
import type {
  NewPayment,
  PaymentForSettlement,
  PaymentRecord,
  SettlePayment,
} from "../types/payment.js";

export interface PaymentRepository {
  /** Replaces the booking's selected method (one row per booking). */
  saveSelection(bookingId: string, method: string, at: Date): Promise<void>;
  findByKey(
    bookingId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null>;
  /** Inserts a PENDING payment; null when a unique key is taken (same mockRef or same idempotency key). */
  create(payment: NewPayment): Promise<PaymentRecord | null>;
  findForSettlement(paymentId: string): Promise<PaymentForSettlement | null>;
  /**
   * Moves a PENDING payment (and, optionally, its booking) to its final state in one transaction.
   * Returns false when the payment was no longer PENDING, so a repeated callback changes nothing.
   */
  settle(input: SettlePayment): Promise<boolean>;
  /** Takes the payment's pending event so exactly one caller publishes it; null when none is owed. */
  claimPendingEvent(paymentId: string): Promise<string | null>;
  /** Hands a claimed event back after a failed publish so a later callback retries it. */
  restorePendingEvent(paymentId: string, event: string): Promise<void>;
}

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNIQUE_VIOLATION
  );
}

const PAYMENT_FIELDS = {
  id: true,
  method: true,
  status: true,
  amount: true,
  currency: true,
  expiresAt: true,
  mockRef: true,
} as const;

const SETTLEMENT_FIELDS = {
  id: true,
  bookingId: true,
  method: true,
  status: true,
  amount: true,
  mockRef: true,
  failureCode: true,
  pendingEvent: true,
  booking: {
    select: {
      pnr: true,
      sessionId: true,
      status: true,
      total: true,
      holdExpiresAt: true,
    },
  },
} as const;

export function createPaymentRepository(
  prisma: PrismaClient,
): PaymentRepository {
  return {
    async saveSelection(bookingId, method, at) {
      await prisma.paymentSelection.upsert({
        where: { bookingId },
        create: { bookingId, method, createdAt: at },
        update: { method },
      });
    },
    findByKey: (bookingId, idempotencyKey) =>
      prisma.payment.findUnique({
        where: { bookingId_idempotencyKey: { bookingId, idempotencyKey } },
        select: PAYMENT_FIELDS,
      }),
    async create(payment) {
      try {
        return await prisma.payment.create({
          data: { ...payment, status: "PENDING" },
          select: PAYMENT_FIELDS,
        });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
    async findForSettlement(paymentId) {
      // Payment and booking are two queries; one RepeatableRead snapshot keeps a concurrent
      // settlement from showing a PENDING payment next to an already PAID booking.
      const row = await prisma.$transaction(
        (tx) =>
          tx.payment.findUnique({
            where: { id: paymentId },
            select: SETTLEMENT_FIELDS,
          }),
        { isolationLevel: "RepeatableRead" },
      );
      return (
        row && {
          ...row,
          booking: {
            ...row.booking,
            status: row.booking.status as BookingStatus,
          },
        }
      );
    },
    settle: (input) =>
      prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: input.paymentId, status: "PENDING" },
          data: {
            status: input.status,
            failureCode: input.failureCode,
            cardLast4: input.cardLast4,
            completedAt: input.completedAt,
            pendingEvent: input.pendingEvent,
          },
        });
        if (updated.count === 0) return false;
        if (input.booking) {
          const payment = await tx.payment.findUniqueOrThrow({
            where: { id: input.paymentId },
            select: { bookingId: true },
          });
          const moved = await tx.booking.updateMany({
            where: { id: payment.bookingId, status: input.booking.from },
            data: { status: input.booking.to },
          });
          // The booking changed under us: roll the payment back instead of leaving them inconsistent.
          if (moved.count === 0) {
            throw new InvalidStateTransitionError(
              input.booking.from,
              input.booking.to,
            );
          }
        }
        return true;
      }),
    async claimPendingEvent(paymentId) {
      const row = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { pendingEvent: true },
      });
      if (!row?.pendingEvent) return null;
      const claimed = await prisma.payment.updateMany({
        where: { id: paymentId, pendingEvent: row.pendingEvent },
        data: { pendingEvent: null },
      });
      return claimed.count === 1 ? row.pendingEvent : null;
    },
    async restorePendingEvent(paymentId, event) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { pendingEvent: event },
      });
    },
  };
}
