import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "@/core/errors/index.js";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * preHandler for the internal webhook: the browser knows `mockRef`, so it must not be able to
 * settle a payment. With no secret configured the check is skipped (local demo).
 */
export function requireCallbackSecret(secret: string | undefined) {
  return async function checkCallbackSecret(
    request: FastifyRequest,
  ): Promise<void> {
    if (secret === undefined) return;
    const given = request.headers["x-callback-secret"];
    if (typeof given !== "string" || !sameSecret(given, secret)) {
      throw new UnauthorizedError("Invalid callback secret");
    }
  };
}
