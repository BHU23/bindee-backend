import { describe, expect, it } from "vitest";
import { generateMockRef } from "@/modules/payment/models/mockRef.js";
import {
  nextPageFor,
  paymentMethodSchema,
} from "@/modules/payment/validators/payment.js";

describe("generateMockRef", () => {
  it("When called, should format MOCK-YYYYMMDD-XXXXXX from the date and random draws", () => {
    const ref = generateMockRef(new Date("2026-10-07T03:00:00.000Z"), () => 0);

    expect(ref).toBe("MOCK-20261007-AAAAAA");
  });
});

describe("payment method rules", () => {
  it("When the method is CARD, should parse and map to /pay/card", () => {
    const parsed = paymentMethodSchema.parse({ method: "CARD" });

    expect(nextPageFor(parsed.method)).toBe("/pay/card");
  });

  it("When the method is not offered yet, should fail", () => {
    expect(
      paymentMethodSchema.safeParse({ method: "MOBILE_BANKING" }).success,
    ).toBe(false);
  });
});
