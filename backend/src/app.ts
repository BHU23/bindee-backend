import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { registerErrorHandler } from "./core/middlewares/errorHandler.js";
import { registerSession } from "./core/middlewares/session.js";
import { registerRoutes } from "./routes/index.js";

export async function buildApp(
  options: FastifyServerOptions = { logger: true },
) {
  const app = Fastify(options);
  registerErrorHandler(app);
  registerSession(app);
  await app.register(helmet);
  await app.register(cors, {
    allowedHeaders: ["Content-Type", "X-Session-Id", "Idempotency-Key"],
  });
  await registerRoutes(app);
  return app;
}
