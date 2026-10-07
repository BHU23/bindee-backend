import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerRoutes } from "@/routes/index.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
