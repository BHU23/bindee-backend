import type { PrismaClient } from "@/database/generated/client.js";
import type { SearchQuery } from "@/modules/inventory/index.js";
import type { RecentSearchRecord } from "../types/search.js";

export interface RecentSearchRepository {
  upsert(input: {
    sessionId: string;
    queryKey: string;
    query: SearchQuery;
    searchedAt: Date;
  }): Promise<void>;
  listLatest(sessionId: string, limit: number): Promise<RecentSearchRecord[]>;
}

export function createRecentSearchRepository(
  prisma: PrismaClient,
): RecentSearchRepository {
  return {
    async upsert({ sessionId, queryKey, query, searchedAt }) {
      const payload = JSON.parse(JSON.stringify(query)) as object;
      await prisma.recentSearch.upsert({
        where: { sessionId_queryKey: { sessionId, queryKey } },
        create: { sessionId, queryKey, payload, searchedAt },
        update: { payload, searchedAt },
      });
    },
    async listLatest(sessionId, limit) {
      const rows = await prisma.recentSearch.findMany({
        where: { sessionId },
        orderBy: [{ searchedAt: "desc" }, { createdAt: "desc" }],
        take: limit,
        select: { id: true, payload: true },
      });
      return rows.map((row) => ({
        id: row.id,
        payload: row.payload as unknown as SearchQuery,
      }));
    },
  };
}
