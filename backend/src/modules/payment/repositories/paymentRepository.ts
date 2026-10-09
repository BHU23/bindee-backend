import type { PrismaClient } from "@/database/generated/client.js";
import type { NewPayment, PaymentRecord } from "../types/payment.js";

export interface PaymentRepository {
  /** Replaces the booking's selected method (one row per booking). */
  saveSelection(bookingId: string, method: string, at: Date): Promise<void>;
  findByKey(
    bookingId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null>;
  create(payment: NewPayment): Promise<PaymentRecord>;
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
    create: (payment) =>
      prisma.payment.create({
        data: { ...payment, status: "PENDING" },
        select: PAYMENT_FIELDS,
      }),
  };
}
