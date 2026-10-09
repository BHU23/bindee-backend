import type { EventBus } from "@/core/events/eventBus.js";
import type { Scheduler } from "@/core/jobs/scheduler.js";

declare module "fastify" {
  interface FastifyInstance {
    eventBus: EventBus;
    scheduler: Scheduler;
  }
}
