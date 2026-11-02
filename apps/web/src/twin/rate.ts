/**
 * A small fixed-window limiter for routes that make MIRA fetch something on a person's behalf
 * (reading a shade page). It lives in the memory of one instance, so it is a courtesy against a
 * loop in the browser, not a defence: the real limits are the allowlist in the agent's fetcher and
 * Cloud Run's own scaling. Keyed by the signed user id, never by anything the request can set.
 */
export class RateLimit {
  private readonly hits = new Map<string, { at: number; n: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if this call is allowed, and counts it. */
  take(key: string): boolean {
    const now = this.now();
    const hit = this.hits.get(key);
    if (hit === undefined || now - hit.at >= this.windowMs) {
      this.hits.set(key, { at: now, n: 1 });
      // Keep the table from growing with every visitor.
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    if (hit.n >= this.max) return false;
    hit.n += 1;
    return true;
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (now - v.at >= this.windowMs) this.hits.delete(k);
  }
}
