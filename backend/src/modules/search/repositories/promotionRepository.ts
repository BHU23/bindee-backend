import type { PrismaClient } from "@/database/generated/client.js";
import type { PromotionRecord } from "../types/search.js";

export interface PromotionRepository {
  findValid(now: Date): Promise<PromotionRecord[]>;
}

export function createPromotionRepository(
  prisma: PrismaClient,
): PromotionRepository {
  return {
    async findValid(now) {
      const rows = await prisma.promotion.findMany({
        where: { promo: { validUntil: { gte: now } } },
        orderBy: [{ promo: { validUntil: "asc" } }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          imageUrl: true,
          originCode: true,
          destinationCode: true,
          promoCode: true,
          promo: { select: { validUntil: true } },
        },
      });
      return rows.map(({ promo, ...rest }) => ({
        ...rest,
        validUntil: promo.validUntil,
      }));
    },
  };
}
