import { describe, expect, it, vi } from "vitest";
import { createPrismaIdempotencyRepository } from "@/core/repositories/prismaIdempotencyRepository.js";

function setup(count = 1) {
  const delegate = {
    createMany: vi.fn(async () => ({ count })),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({})),
  };
  return { delegate, repo: createPrismaIdempotencyRepository(delegate) };
}

describe("PrismaIdempotencyRepository (delegate mocked; real DB behaviour NOT VERIFIED in CI)", () => {
  it("When the unique key was free, should report the record as created", async () => {
    const { repo, delegate } = setup(1);
    expect(
      await repo.tryCreate({ key: "k", scope: "s", requestHash: "h" }),
    ).toBe(true);
    expect(delegate.createMany).toHaveBeenCalledWith({
      data: [{ key: "k", scope: "s", requestHash: "h" }],
      skipDuplicates: true,
    });
  });

  it("When the key already exists, should report not created", async () => {
    const { repo } = setup(0);
    expect(
      await repo.tryCreate({ key: "k", scope: "s", requestHash: "h" }),
    ).toBe(false);
  });

  it("When reading, marking done and removing, should address the (scope, key) pair", async () => {
    const { repo, delegate } = setup();
    await repo.find("s", "k");
    await repo.markDone("s", "k", undefined);
    await repo.remove("s", "k");
    expect(delegate.findUnique).toHaveBeenCalledWith({
      where: { scope_key: { scope: "s", key: "k" } },
    });
    expect(delegate.update).toHaveBeenCalledWith({
      where: { scope_key: { scope: "s", key: "k" } },
      data: { status: "DONE", response: null },
    });
    expect(delegate.deleteMany).toHaveBeenCalledWith({
      where: { scope: "s", key: "k" },
    });
  });
});
