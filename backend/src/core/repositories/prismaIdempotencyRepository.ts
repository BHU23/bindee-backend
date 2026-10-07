import type { Prisma } from "../../database/generated/client.js";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
} from "../utils/idempotency.js";

interface IdempotencyDelegate {
  createMany(args: {
    data: { key: string; scope: string; requestHash: string }[];
    skipDuplicates: boolean;
  }): Promise<{ count: number }>;
  findUnique(args: {
    where: { scope_key: { scope: string; key: string } };
  }): Promise<IdempotencyRecord | null>;
  update(args: {
    where: { scope_key: { scope: string; key: string } };
    data: { status: "DONE"; response: Prisma.InputJsonValue };
  }): Promise<unknown>;
  deleteMany(args: { where: { scope: string; key: string } }): Promise<unknown>;
}

export function createPrismaIdempotencyRepository(
  delegate: IdempotencyDelegate,
): IdempotencyRepository {
  return {
    async tryCreate(input) {
      // The unique (scope, key) constraint decides the winner of concurrent requests.
      const { count } = await delegate.createMany({
        data: [input],
        skipDuplicates: true,
      });
      return count === 1;
    },
    find: (scope, key) =>
      delegate.findUnique({ where: { scope_key: { scope, key } } }),
    async markDone(scope, key, response) {
      await delegate.update({
        where: { scope_key: { scope, key } },
        data: {
          status: "DONE",
          response: (response ?? null) as Prisma.InputJsonValue,
        },
      });
    },
    async remove(scope, key) {
      await delegate.deleteMany({ where: { scope, key } });
    },
  };
}
