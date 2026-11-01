/** Time as a port, so cache TTLs, poll backoff and queue delays are testable (docs/TESTING.md). */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/** A clock that only moves when told to. `advance` wakes every sleeper that is now due. */
export class FakeClock implements Clock {
  private time: number;
  private sleepers: { at: number; wake: () => void }[] = [];

  constructor(start = Date.UTC(2026, 10, 1, 9, 0, 0)) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepers.push({ at: this.time + ms, wake: resolve });
    });
  }

  /** Moves time forward and lets sleepers that became due run before returning. */
  async advance(ms: number): Promise<void> {
    this.time += ms;
    const due = this.sleepers.filter((s) => s.at <= this.time);
    this.sleepers = this.sleepers.filter((s) => s.at > this.time);
    for (const s of due) s.wake();
    // Let woken promises (and anything they schedule) settle.
    await new Promise((resolve) => setImmediate(resolve));
  }
}
