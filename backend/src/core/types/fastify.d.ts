import type { EventBus } from "../events/eventBus.js";
import type { Scheduler } from "../jobs/scheduler.js";

declare module "fastify" {
  interface FastifyInstance {
    eventBus: EventBus;
    scheduler: Scheduler;
  }
}
