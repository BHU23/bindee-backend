-- AlterTable
ALTER TABLE "airport" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok';

-- AlterTable
ALTER TABLE "flight" ADD COLUMN     "stops" INTEGER NOT NULL DEFAULT 0;
