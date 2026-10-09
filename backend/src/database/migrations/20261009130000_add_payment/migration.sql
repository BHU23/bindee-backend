-- CreateTable
CREATE TABLE "payment_selection" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "mock_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_selection_booking_id_key" ON "payment_selection"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_mock_ref_key" ON "payment"("mock_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payment_booking_id_idempotency_key_key" ON "payment"("booking_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "payment_selection" ADD CONSTRAINT "payment_selection_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
