import { describe, expect, it } from "vitest";
import { parseEnv } from "@/config/env.js";

const base = {
  DATABASE_URL: "postgresql://x",
  REDIS_URL: "redis://localhost:6379",
};

describe("parseEnv", () => {
  describe("AC-FND-14 when REDIS_URL is missing", () => {
    it("When REDIS_URL is not set, should fail fast naming the variable", () => {
      expect(() => parseEnv({ DATABASE_URL: "postgresql://x" })).toThrow(
        /REDIS_URL/,
      );
    });
  });

  describe("AC-INV-06 force price change trigger", () => {
    it("When INVENTORY_FORCE_PRICE_CHANGE is set, should expose the flight number", () => {
      const env = parseEnv({ ...base, INVENTORY_FORCE_PRICE_CHANGE: "BN 102" });
      expect(env.INVENTORY_FORCE_PRICE_CHANGE).toBe("BN 102");
    });

    it("When it is not set, should be undefined", () => {
      expect(parseEnv(base).INVENTORY_FORCE_PRICE_CHANGE).toBeUndefined();
    });
  });

  describe("when the environment is valid", () => {
    it("When required variables are set, should apply defaults", () => {
      const env = parseEnv(base);
      expect(env).toMatchObject({
        NODE_ENV: "development",
        PORT: 3000,
        REDIS_URL: base.REDIS_URL,
      });
    });
  });
});
