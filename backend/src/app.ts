import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { registerRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(helmet);
  await app.register(cors);
  await registerRoutes(app);
  return app;
}
