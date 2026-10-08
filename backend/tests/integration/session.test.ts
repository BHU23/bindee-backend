import { describe, expect, it } from "vitest";
import { buildApp } from "@/app.js";

async function buildTestApp() {
  const app = await buildApp({ logger: false });
  app.get("/_t/session", async (request) => ({
    sessionId: request.sessionId ?? null,
  }));
  return app;
}

describe("guest session", () => {
  describe("AC-FND-09 X-Session-Id", () => {
    it("When a valid X-Session-Id is sent, should expose it on the request without any login", async () => {
      const app = await buildTestApp();
      const id = "0b9c7a52-1d2e-4a3b-9c4d-5e6f7a8b9c0d";
      const res = await app.inject({
        method: "GET",
        url: "/_t/session",
        headers: { "x-session-id": id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ sessionId: id });
    });

    it("When no X-Session-Id is sent, should still serve the request as an anonymous guest", async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: "GET", url: "/_t/session" });
      expect(res.json()).toEqual({ sessionId: null });
    });

    it("When X-Session-Id is not a UUID, should return 400 VALIDATION_ERROR", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "GET",
        url: "/_t/session",
        headers: { "x-session-id": "nope" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("When a browser preflights, should allow the X-Session-Id and Idempotency-Key headers", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "OPTIONS",
        url: "/_t/session",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "POST",
        },
      });
      expect(res.headers["access-control-allow-headers"]).toMatch(
        /X-Session-Id/i,
      );
      expect(res.headers["access-control-allow-headers"]).toMatch(
        /Idempotency-Key/i,
      );
    });

    it("When a browser preflights a PUT, should allow the PUT method", async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: "OPTIONS",
        url: "/_t/session",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "PUT",
        },
      });
      expect(res.headers["access-control-allow-methods"]).toMatch(/\bPUT\b/);
    });
  });
});
