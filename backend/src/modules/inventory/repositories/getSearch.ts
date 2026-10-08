import { NotFoundError, SearchExpiredError } from "@/core/errors/index.js";
import type { PrismaClient } from "@/database/generated/client.js";
import type { StoredSearch } from "@/modules/inventory/types/inventory.js";
import { SNAPSHOT_TTL_MS, type SnapshotData } from "./snapshot.js";

export async function getSearch(
  prisma: PrismaClient,
  now: Date,
  input: { searchId: string; sessionId?: string },
): Promise<StoredSearch> {
  const snapshot = await prisma.searchSnapshot.findUnique({
    where: { id: input.searchId },
  });
  const data = snapshot?.data as unknown as Partial<SnapshotData> | undefined;
  // Snapshots written before v2 have no query/results and cannot be re-read.
  if (!snapshot || !data?.query || !data.results) {
    throw new NotFoundError("NOT_FOUND", "Search not found");
  }
  // A search created in a session is visible to that session only.
  if (data.sessionId && data.sessionId !== input.sessionId) {
    throw new NotFoundError("NOT_FOUND", "Search not found");
  }
  const expiresAt = new Date(snapshot.createdAt.getTime() + SNAPSHOT_TTL_MS);
  if (now.getTime() > expiresAt.getTime()) {
    throw new SearchExpiredError(undefined, data.query);
  }
  return {
    query: data.query,
    searchedAt: snapshot.createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    outbound: data.results.outbound,
    ...(data.results.inbound ? { inbound: data.results.inbound } : {}),
    calendar: data.results.calendar,
  };
}
