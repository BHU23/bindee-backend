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

  it("When the method is PROMPTPAY_QR or MOBILE_BANKING, should parse and map to its mock page", () => {
    expect(
      nextPageFor(paymentMethodSchema.parse({ method: "PROMPTPAY_QR" }).method),
    ).toBe("/pay/qr");
    expect(
      nextPageFor(
        paymentMethodSchema.parse({ method: "MOBILE_BANKING" }).method,
      ),
    ).toBe("/pay/mobile-banking");
  });

  it("AC-PM-04: When the bank is one of the five offered, should parse; when omitted, should parse", () => {
    for (const bank of ["KBANK", "SCB", "KRUNGSRI", "BBL", "TTB"]) {
      expect(
        paymentMethodSchema.safeParse({ method: "MOBILE_BANKING", bank })
          .success,
      ).toBe(true);
    }
    expect(
      paymentMethodSchema.safeParse({ method: "MOBILE_BANKING" }).success,
    ).toBe(true);
  });

  it("AC-PM-04: When the bank is unknown, should fail", () => {
    expect(
      paymentMethodSchema.safeParse({ method: "MOBILE_BANKING", bank: "ACME" })
        .success,
    ).toBe(false);
  });

  it("When the method is unknown, should fail", () => {
    expect(paymentMethodSchema.safeParse({ method: "BITCOIN" }).success).toBe(
      false,
    );
  });
});
