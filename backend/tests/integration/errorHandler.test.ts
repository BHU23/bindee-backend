import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "../../src/app.js";
import { validate } from "../../src/core/utils/validate.js";
import { ConflictError } from "../../src/core/errors/index.js";

async function buildTestApp() {
  const app = await buildApp({ logger: false });
  app.post("/_t/validate", async (request) => {
    const body = validate(
      z.object({ name: z.string().min(1), age: z.number() }),
      request.body,
    );
    return body;
  });
  app.get("/_t/zod", async () => {
    z.object({ id: z.string() }).parse({});
  });
  app.get("/_t/boom", async () => {
    throw new Error("db password=secret at /srv/app.ts:12");
  });
  app.get("/_t/conflict", async () => {
    throw new ConflictError("SEAT_UNAVAILABLE", "Seat taken");
  });
  return app;
}

describe("error handler", () => {
  describe("AC-FND-01 validation failure", () => {
    it("When the body fails Zod validation, should return 400 VALIDATION_ERROR with fields", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "POST",
        url: "/_t/validate",
        payload: { name: "", age: "x" },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(body.error.fields)).toEqual(
        expect.arrayContaining(["name", "age"]),
      );
    });
  });

  describe("AC-FND-02 unexpected error", () => {
    it("When a handler throws, should return 500 INTERNAL_ERROR without stack or secrets", async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: "GET", url: "/_t/boom" });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
      expect(res.body).not.toMatch(/secret|app\.ts|stack/);
    });
  });

  describe("typed errors", () => {
    it("When a typed AppError is thrown, should map status and code", async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: "GET", url: "/_t/conflict" });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        error: { code: "SEAT_UNAVAILABLE", message: "Seat taken" },
      });
    });

    it("When a raw ZodError escapes a handler, should map it to 400 VALIDATION_ERROR with fields", async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: "GET", url: "/_t/zod" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toHaveProperty("id");
    });

    it("When the route does not exist, should return 404 NOT_FOUND in the standard shape", async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: "GET", url: "/nope" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    });

    it("When the JSON body is malformed, should return 400 VALIDATION_ERROR", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "POST",
        url: "/_t/validate",
        payload: "{bad",
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });
});
