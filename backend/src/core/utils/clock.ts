export type CancelTimer = () => void;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, delayMs: number): CancelTimer;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, delayMs) {
    const handle = setTimeout(fn, delayMs);
    return () => clearTimeout(handle);
  },
};

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Controllable clock for tests of the in-memory event bus and scheduler. */
export class ManualClock implements Clock {
  private time = 0;
  private nextId = 1;
  private timers: Timer[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, delayMs: number): CancelTimer {
    const timer: Timer = { id: this.nextId++, at: this.time + delayMs, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t.id !== timer.id);
    };
  }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.time = next.at;
      next.fn();
      await flushMicrotasks();
    }
    this.time = target;
  }
}
