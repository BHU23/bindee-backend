import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "../../../src/core/utils/clock.js";
import { NotFoundError } from "../../../src/core/errors/index.js";
import { guard } from "../../../src/modules/inventory/repositories/guard.js";
import { createPrismaInventory } from "../../../src/modules/inventory/repositories/prismaInventory.js";
import type { PrismaClient } from "../../../src/database/generated/client.js";

describe("INVENTORY_UNAVAILABLE on dependency failure", () => {
  it("When the database throws, should surface INVENTORY_UNAVAILABLE (503) with the cause", async () => {
    const cause = new Error("connection refused");
    const prisma = {
      flight: { findMany: vi.fn().mockRejectedValue(cause) },
    } as unknown as PrismaClient;
    const inventory = createPrismaInventory({
      prisma,
      clock: new ManualClock(),
    });

    const error = await inventory
      .getFromPrices({
        routes: [{ origin: "BKK", destination: "CNX" }],
        days: 7,
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 503,
      code: "INVENTORY_UNAVAILABLE",
      cause,
    });
  });

  it("When a domain error is thrown, should pass it through unchanged", async () => {
    const notFound = new NotFoundError();
    await expect(guard(() => Promise.reject(notFound))).rejects.toBe(notFound);
  });
});
