-- CreateTable
CREATE TABLE "booking_draft" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "search_id" TEXT NOT NULL,
    "trip_type" TEXT NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "infants" INTEGER NOT NULL,
    "searched_at" TIMESTAMP(3) NOT NULL,
    "outbound_flight_id" TEXT,
    "outbound_fare_family" "FareFamily",
    "outbound_price" INTEGER,
    "outbound_arrive_at" TIMESTAMP(3),
    "outbound_pending_price" INTEGER,
    "return_flight_id" TEXT,
    "return_fare_family" "FareFamily",
    "return_price" INTEGER,
    "return_pending_price" INTEGER,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_draft_session_id_idx" ON "booking_draft"("session_id");
