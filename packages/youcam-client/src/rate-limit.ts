import type { Clock } from "@mira/runtime";
import type { YouCamError } from "./errors";

export interface RateLimitOptions {
  /** Calls allowed in any window. */
  limit: number;
  windowMs: number;
  /** A call that would wait longer fails as retryable `rate_limited` instead of blocking a worker. */
  maxWaitMs: number;
  clock: Clock;
}

const tooBusy = (waitMs: number): YouCamError => ({
  kind: "rate_limited",
  code: "rate_limited",
  message: `Held back by MIRA's own rate limit (would wait ${String(Math.ceil(waitMs / 1000))} s)`,
  retryable: true,
  guidance: "retry",
  unitsCharged: 0,
});

/**
 * A sliding window over the last `windowMs`: at most `limit` calls, exactly. YouCam's limit is
 * 250 requests per 300 s per key and per IP, every poll counts, and one submit can be four calls
 * (three registers and a create), so queue rates alone cannot promise to stay under it. The
 * limiter sits in the HTTP transport (`YouCamHttp`), so every request is counted, including each
 * page of a paged read. A presigned upload goes to the storage host, not YouCam's API, and is not.
 */
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(private readonly o: RateLimitOptions) {}

  /** Resolves when a call may be made, or with an error if it would wait too long. */
  async acquire(): Promise<YouCamError | undefined> {
    for (;;) {
      const now = this.o.clock.now();
      while (this.stamps.length > 0 && (this.stamps[0] ?? 0) <= now - this.o.windowMs)
        this.stamps.shift();
      if (this.stamps.length < this.o.limit) {
        this.stamps.push(now);
        return undefined;
      }
      const wait = (this.stamps[0] ?? now) + this.o.windowMs - now;
      if (wait > this.o.maxWaitMs) return tooBusy(wait);
      await this.o.clock.sleep(wait);
    }
  }

  /** Calls counted in the current window. */
  get used(): number {
    const now = this.o.clock.now();
    return this.stamps.filter((t) => t > now - this.o.windowMs).length;
  }
}
