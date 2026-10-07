import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { JobFn, JobName, Scheduler } from "./scheduler.js";

export const SCHEDULED_JOBS_QUEUE = "scheduled-jobs";

export class BullmqScheduler implements Scheduler {
  private readonly queue: Queue;
  private readonly jobs = new Map<string, JobFn>();
  private worker: Worker | undefined;

  constructor(private readonly connection: ConnectionOptions) {
    this.queue = new Queue(SCHEDULED_JOBS_QUEUE, { connection });
  }

  async registerJob(name: JobName, everyMs: number, fn: JobFn): Promise<void> {
    this.jobs.set(name, fn);
    // The scheduler id is the stable job id: re-registering after a restart updates the same schedule.
    await this.queue.upsertJobScheduler(name, { every: everyMs }, { name });
    this.worker ??= new Worker(
      SCHEDULED_JOBS_QUEUE,
      (job) => this.run(job.name),
      {
        connection: this.connection,
        concurrency: 1,
      },
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  private async run(name: string): Promise<void> {
    await this.jobs.get(name)?.();
  }
}
