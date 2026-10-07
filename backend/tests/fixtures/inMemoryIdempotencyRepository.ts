import type {
  IdempotencyRecord,
  IdempotencyRepository,
} from "@/core/utils/idempotency.js";

export function createInMemoryIdempotencyRepository(): IdempotencyRepository {
  const rows = new Map<string, IdempotencyRecord>();
  function id(scope: string, key: string): string {
    return `${scope}\u0000${key}`;
  }
  return {
    async tryCreate({ key, scope, requestHash }) {
      if (rows.has(id(scope, key))) return false;
      rows.set(id(scope, key), {
        key,
        scope,
        requestHash,
        status: "IN_PROGRESS",
        response: null,
        createdAt: new Date(),
      });
      return true;
    },
    async find(scope, key) {
      return rows.get(id(scope, key)) ?? null;
    },
    async markDone(scope, key, response) {
      const row = rows.get(id(scope, key));
      if (row) rows.set(id(scope, key), { ...row, status: "DONE", response });
    },
    async remove(scope, key) {
      rows.delete(id(scope, key));
    },
  };
}
