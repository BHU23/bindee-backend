import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { systemClock } from "./core/utils/clock.js";
import { createPrismaInventory } from "./modules/inventory/index.js";
import { createSearchService } from "./modules/search/index.js";
import { env } from "./config/env.js";
import { prisma } from "./database/client/prisma.js";
import { BullmqEventBus } from "./core/events/bullmqEventBus.js";
import { BullmqScheduler } from "./core/jobs/bullmqScheduler.js";

const inventory = createPrismaInventory({
  prisma,
  clock: systemClock,
  forcePriceChangeFlight: env.INVENTORY_FORCE_PRICE_CHANGE,
});
const searchService = createSearchService({
  prisma,
  clock: systemClock,
  inventory,
});
const app = await buildApp({ logger: true }, { searchService });

// BullMQ workers need a blocking connection with no per-request retry limit.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const eventBus = new BullmqEventBus(redis);
const scheduler = new BullmqScheduler(redis);
// Subscribers and job bodies (expire-holds, retry-ticketing, reconcile-paid, complete-refunds)
// are registered by the specs that own them, using `eventBus` and `scheduler`.
app.decorate("eventBus", eventBus);
app.decorate("scheduler", scheduler);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await scheduler.close();
  await eventBus.close();
  redis.disconnect();
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal).then(() => process.exit(0)));
}

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
