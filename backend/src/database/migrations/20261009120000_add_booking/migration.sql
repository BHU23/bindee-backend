-- CreateTable
CREATE TABLE "booking" (
    "id" TEXT NOT NULL,
    "pnr" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "hold_id" TEXT NOT NULL,
    "hold_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_pnr_key" ON "booking"("pnr");

-- CreateIndex
CREATE UNIQUE INDEX "booking_draft_id_key" ON "booking"("draft_id");

-- CreateIndex
CREATE INDEX "booking_session_id_idx" ON "booking"("session_id");

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "booking_draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

