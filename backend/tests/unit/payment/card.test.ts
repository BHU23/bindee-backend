import { describe, expect, it } from "vitest";
import {
  lastFour,
  outcomeForCard,
} from "@/modules/payment/models/testCards.js";
import {
  cardSchema,
  paymentIdParamsSchema,
} from "@/modules/payment/validators/card.js";

const valid = {
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/30",
  cvv: "123",
};

describe("cardSchema", () => {
  it("AC-MP-12: When the card is well formed with spaces, should strip the spaces", () => {
    expect(cardSchema.parse(valid).cardNumber).toBe("4242424242424242");
  });

  it("AC-MP-12: When the number has 13 to 19 digits, should accept it without a Luhn check", () => {
    for (const cardNumber of ["1234567890123", "1".repeat(19)]) {
      expect(cardSchema.safeParse({ ...valid, cardNumber }).success).toBe(true);
    }
  });

  it("AC-MP-12: When the number is not 13 to 19 digits, should fail on cardNumber", () => {
    for (const cardNumber of [
      "",
      "123456789012",
      "1".repeat(20),
      "42a2 4242 4242 4242",
    ]) {
      const result = cardSchema.safeParse({ ...valid, cardNumber });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["cardNumber"]);
    }
  });

  it("AC-MP-12: When the expiry is not MM/YY or the month is outside 01-12, should fail on expiry", () => {
    for (const expiry of ["1230", "13/30", "00/30", "1/30", "12/2030"]) {
      const result = cardSchema.safeParse({ ...valid, expiry });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["expiry"]);
    }
  });

  it("AC-MP-12: When the expiry is well formed but in the past, should accept it", () => {
    expect(cardSchema.safeParse({ ...valid, expiry: "01/20" }).success).toBe(
      true,
    );
  });

  it("AC-MP-12: When the CVV is not 3 or 4 digits, should fail on cvv", () => {
    for (const cvv of ["12", "12345", "12a"]) {
      const result = cardSchema.safeParse({ ...valid, cvv });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["cvv"]);
    }
    expect(cardSchema.safeParse({ ...valid, cvv: "1234" }).success).toBe(true);
  });

  it("When only the card number is sent, should accept it (name, expiry and CVV are optional)", () => {
    expect(
      cardSchema.safeParse({ cardNumber: "4242424242424242" }).success,
    ).toBe(true);
  });

  it("When the card number is missing, should fail", () => {
    expect(cardSchema.safeParse({}).success).toBe(false);
  });
});

describe("paymentIdParamsSchema", () => {
  it("When the id is not a uuid, should fail", () => {
    expect(paymentIdParamsSchema.safeParse({ paymentId: "nope" }).success).toBe(
      false,
    );
  });
});

describe("outcomeForCard", () => {
  it("AC-MP-02, 03, 04: When the number is a test card, should return its outcome", () => {
    expect(outcomeForCard("4242424242424242")).toEqual({ result: "SUCCESS" });
    expect(outcomeForCard("4000000000000002")).toEqual({
      result: "FAILED",
      failureCode: "MOCK_DECLINED",
    });
    expect(outcomeForCard("4000000000000119")).toEqual({
      result: "FAILED",
      failureCode: "MOCK_TIMEOUT",
    });
  });

  it("AC-MP-13: When the number is well formed but not a test card, should return null", () => {
    expect(outcomeForCard("4111111111111111")).toBeNull();
  });
});

describe("lastFour", () => {
  it("AC-MP-09: When given a card number, should return only its last 4 digits", () => {
    expect(lastFour("4242424242424242")).toBe("4242");
  });
});
