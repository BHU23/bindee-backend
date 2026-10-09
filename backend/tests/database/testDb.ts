import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/database/generated/client.js";

export const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://bindee:bindee@localhost:5432/bindee_test?schema=public";

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });
}

/** Empties every inventory table so a test file starts from a known state. */
export async function resetInventory(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "booking_draft", "seat_hold_item", "seat_hold", "seat", "flight_fare", "flight", "route", "airport", "search_snapshot", "recent_search", "promotion", "promo_code", "addon_price" CASCADE',
  );
}

export const SEED_NOW = new Date("2026-10-07T03:00:00.000Z");
export const SEED_DAYS = 12;
