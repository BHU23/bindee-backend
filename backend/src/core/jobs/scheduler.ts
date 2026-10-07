export const JOB_NAMES = [
  "expire-holds",
  "retry-ticketing",
  "reconcile-paid",
  "complete-refunds",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export type JobFn = () => Promise<void>;

export interface Scheduler {
  /** Registers (or re-registers after a restart) a job that runs every `everyMs`. One instance at a time. */
  registerJob(name: JobName, everyMs: number, fn: JobFn): Promise<void>;
  close(): Promise<void>;
}
