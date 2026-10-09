-- AlterTable
ALTER TABLE "booking_draft" ADD COLUMN     "consent_marketing" BOOLEAN,
ADD COLUMN     "consent_privacy" BOOLEAN,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT;

-- CreateTable
CREATE TABLE "passenger" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "dob" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "passport_no" TEXT,
    "passport_country" TEXT,
    "passport_expiry" TEXT,
    "infant_of_pax_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passenger_draft_id_position_key" ON "passenger"("draft_id", "position");

-- AddForeignKey
ALTER TABLE "passenger" ADD CONSTRAINT "passenger_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "booking_draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

