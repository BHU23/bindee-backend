// Manual smoke test against a real Redis (run by hand, not part of CI): `pnpm smoke:queue`.
import { Redis } from "ioredis";
import { BullmqEventBus } from "@/core/events/bullmqEventBus.js";
import { BullmqScheduler } from "@/core/jobs/bullmqScheduler.js";
import { parseEnv } from "@/config/env.js";

const env = parseEnv(process.env);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const eventBus = new BullmqEventBus(redis, { attempts: 2, backoffMs: 200 });
const scheduler = new BullmqScheduler(redis);

function waitFor(
  label: string,
  promise: Promise<unknown>,
  timeoutMs = 10_000,
): Promise<unknown> {
  const timeout = new Promise((_resolve, reject) =>
    setTimeout(
      () => reject(new Error(`timed out waiting for ${label}`)),
      timeoutMs,
    ),
  );
  return Promise.race([promise, timeout]);
}

try {
  const received = new Promise<void>((resolve) => {
    eventBus.subscribe("BookingCreated", async (event) => {
      console.log("event received:", event);
      resolve();
    });
  });
  await eventBus.publish({
    name: "BookingCreated",
    payload: { bookingId: "smoke" },
  });
  await waitFor("domain event", received);

  const ran = new Promise<void>((resolve) => {
    void scheduler.registerJob("reconcile-paid", 500, async () => {
      console.log("job ran: reconcile-paid");
      resolve();
    });
  });
  await waitFor("scheduled job", ran);
  console.log("smoke:queue OK");
} finally {
  await scheduler.close();
  await eventBus.close();
  redis.disconnect();
}
