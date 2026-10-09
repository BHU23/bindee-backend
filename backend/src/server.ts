import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { systemClock } from "./core/utils/clock.js";
import { createPrismaInventory } from "./modules/inventory/index.js";
import { createPrismaIdempotencyRepository } from "./core/repositories/prismaIdempotencyRepository.js";
import { createWithIdempotency } from "./core/utils/idempotency.js";
import { createBookingService } from "./modules/booking/index.js";
import { createPaymentService } from "./modules/payment/index.js";
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
// BullMQ workers need a blocking connection with no per-request retry limit.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const eventBus = new BullmqEventBus(redis);
const scheduler = new BullmqScheduler(redis);
const bookingService = createBookingService({
  prisma,
  clock: systemClock,
  inventory,
  eventBus,
  withIdempotency: createWithIdempotency({
    repository: createPrismaIdempotencyRepository(prisma.idempotencyRecord),
  }),
});
const paymentService = createPaymentService({
  prisma,
  clock: systemClock,
  eventBus,
  holdGraceSeconds: env.HOLD_GRACE_SECONDS,
  withIdempotency: createWithIdempotency({
    repository: createPrismaIdempotencyRepository(prisma.idempotencyRecord),
  }),
});
const app = await buildApp(
  { logger: true },
  {
    searchService,
    bookingService,
    paymentService,
    ...(env.MOCK_CALLBACK_SECRET
      ? { mockCallbackSecret: env.MOCK_CALLBACK_SECRET }
      : {}),
  },
);

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
