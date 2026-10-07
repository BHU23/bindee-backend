-- CreateEnum
CREATE TYPE "FareFamily" AS ENUM ('LITE', 'VALUE', 'FLEX');

-- CreateEnum
CREATE TYPE "SeatKind" AS ENUM ('WINDOW', 'AISLE', 'EXIT');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'SOLD');

-- CreateEnum
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENT', 'FIXED_PER_PAX');

-- CreateTable
CREATE TABLE "airport" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airport_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "route" (
    "id" TEXT NOT NULL,
    "origin_code" TEXT NOT NULL,
    "destination_code" TEXT NOT NULL,
    "international" BOOLEAN NOT NULL DEFAULT false,
    "duration_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight" (
    "id" TEXT NOT NULL,
    "flight_no" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "depart_at" TIMESTAMP(3) NOT NULL,
    "arrive_at" TIMESTAMP(3) NOT NULL,
    "aircraft" TEXT NOT NULL,
    "price_factor" DECIMAL(4,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_fare" (
    "id" TEXT NOT NULL,
    "flight_id" TEXT NOT NULL,
    "family" "FareFamily" NOT NULL,
    "base_price" INTEGER NOT NULL,
    "airport_tax" INTEGER NOT NULL,
    "fuel_surcharge" INTEGER NOT NULL,
    "service_fee" INTEGER NOT NULL,
    "cabin_bag_kg" INTEGER NOT NULL,
    "checked_bag_kg" INTEGER NOT NULL,
    "change_allowed" BOOLEAN NOT NULL,
    "change_fee" INTEGER NOT NULL,
    "refund_allowed" BOOLEAN NOT NULL,
    "refund_fee" INTEGER NOT NULL,
    "seat_included" BOOLEAN NOT NULL,
    "reprice_trigger" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "flight_fare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat" (
    "id" TEXT NOT NULL,
    "flight_id" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "letter" TEXT NOT NULL,
    "kind" "SeatKind" NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_hold" (
    "id" TEXT NOT NULL,
    "booking_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "seat_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_hold_item" (
    "id" TEXT NOT NULL,
    "hold_id" TEXT NOT NULL,
    "seat_id" TEXT NOT NULL,
    "pax_index" INTEGER,

    CONSTRAINT "seat_hold_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_snapshot" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "search_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code" (
    "code" TEXT NOT NULL,
    "discount_type" "PromoDiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "min_base_fare" INTEGER NOT NULL,
    "domestic_only" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "promo_code_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "addon_price" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price_domestic" INTEGER NOT NULL,
    "price_international" INTEGER NOT NULL,

    CONSTRAINT "addon_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "route_origin_code_destination_code_key" ON "route"("origin_code", "destination_code");

-- CreateIndex
CREATE INDEX "flight_route_id_depart_at_idx" ON "flight"("route_id", "depart_at");

-- CreateIndex
CREATE UNIQUE INDEX "flight_flight_no_depart_at_key" ON "flight"("flight_no", "depart_at");

-- CreateIndex
CREATE UNIQUE INDEX "flight_fare_flight_id_family_key" ON "flight_fare"("flight_id", "family");

-- CreateIndex
CREATE INDEX "seat_flight_id_status_idx" ON "seat"("flight_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seat_flight_id_row_letter_key" ON "seat"("flight_id", "row", "letter");

-- CreateIndex
CREATE INDEX "seat_hold_expires_at_idx" ON "seat_hold"("expires_at");

-- CreateIndex
CREATE INDEX "seat_hold_item_seat_id_idx" ON "seat_hold_item"("seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_hold_item_hold_id_seat_id_key" ON "seat_hold_item"("hold_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "addon_price_category_code_key" ON "addon_price"("category", "code");

-- AddForeignKey
ALTER TABLE "route" ADD CONSTRAINT "route_origin_code_fkey" FOREIGN KEY ("origin_code") REFERENCES "airport"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route" ADD CONSTRAINT "route_destination_code_fkey" FOREIGN KEY ("destination_code") REFERENCES "airport"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight" ADD CONSTRAINT "flight_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_fare" ADD CONSTRAINT "flight_fare_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_hold_item" ADD CONSTRAINT "seat_hold_item_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "seat_hold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_hold_item" ADD CONSTRAINT "seat_hold_item_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
