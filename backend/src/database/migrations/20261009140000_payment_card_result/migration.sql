-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "card_last4" TEXT,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "failure_code" TEXT;
