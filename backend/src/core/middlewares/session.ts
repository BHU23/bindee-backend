import type { FastifyInstance } from "fastify";
import { ValidationError } from "@/core/errors/index.js";

declare module "fastify" {
  interface FastifyRequest {
    sessionId: string | undefined;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guest session: the id only groups requests, it is not a credential. */
export function registerSession(app: FastifyInstance): void {
  app.decorateRequest("sessionId", undefined);
  app.addHook("onRequest", async (request) => {
    const header = request.headers["x-session-id"];
    if (header === undefined) return;
    if (typeof header !== "string" || !UUID.test(header)) {
      throw new ValidationError("X-Session-Id must be a UUID", {
        "X-Session-Id": "invalid",
      });
    }
    request.sessionId = header;
  });
}
