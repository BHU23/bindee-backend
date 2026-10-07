import { type CancelTimer, type Clock, systemClock } from "../utils/clock.js";
import type { JobFn, JobName, Scheduler } from "./scheduler.js";

interface Registration {
  cancel: CancelTimer;
  running: boolean;
}

export class InMemoryScheduler implements Scheduler {
  private readonly jobs = new Map<JobName, Registration>();

  constructor(private readonly clock: Clock = systemClock) {}

  async registerJob(name: JobName, everyMs: number, fn: JobFn): Promise<void> {
    this.jobs.get(name)?.cancel();
    const registration: Registration = {
      running: false,
      cancel: this.clock.setTimeout(() => tick(), everyMs),
    };
    this.jobs.set(name, registration);
    const clock = this.clock;
    function tick(): void {
      registration.cancel = clock.setTimeout(tick, everyMs);
      if (registration.running) return;
      registration.running = true;
      void fn()
        .catch(() => undefined)
        .finally(() => {
          registration.running = false;
        });
    }
  }

  async close(): Promise<void> {
    for (const job of this.jobs.values()) job.cancel();
    this.jobs.clear();
  }
}
