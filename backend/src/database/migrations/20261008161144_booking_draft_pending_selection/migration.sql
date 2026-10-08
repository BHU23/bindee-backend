/*
  Warnings:

  - You are about to drop the column `outbound_pending_price` on the `booking_draft` table. All the data in the column will be lost.
  - You are about to drop the column `return_pending_price` on the `booking_draft` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "booking_draft" DROP COLUMN "outbound_pending_price",
DROP COLUMN "return_pending_price",
ADD COLUMN     "outbound_pending_fare_family" "FareFamily",
ADD COLUMN     "outbound_pending_flight_id" TEXT,
ADD COLUMN     "return_pending_fare_family" "FareFamily",
ADD COLUMN     "return_pending_flight_id" TEXT;
