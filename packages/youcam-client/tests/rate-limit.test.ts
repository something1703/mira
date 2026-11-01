import { FakeClock } from "@mira/runtime";
import { describe, expect, it } from "vitest";
import { HttpYouCamApi, RateLimiter, type FetchLike } from "../src";

const make = (limit = 3, windowMs = 10_000, maxWaitMs = 2_000) => {
  const clock = new FakeClock();
  return { clock, limiter: new RateLimiter({ limit, windowMs, maxWaitMs, clock }) };
};

describe("RateLimiter", () => {
  it("allows exactly `limit` calls in a window, then refuses one that would wait too long", async () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i++) expect(await limiter.acquire()).toBeUndefined();
    const blocked = await limiter.acquire();
    expect(blocked).toMatchObject({
      kind: "rate_limited",
      code: "rate_limited",
      retryable: true,
      unitsCharged: 0,
    });
    expect(blocked?.message).toContain("10 s");
    expect(limiter.used).toBe(3);
  });

  it("waits when the wait is short, then lets the call through", async () => {
    const { clock, limiter } = make(2, 10_000, 5_000);
    await limiter.acquire();
    await clock.advance(6_000);
    await limiter.acquire();
    // The first stamp leaves the window in 4 s, which is within the 5 s patience.
    let done = false;
    const pending = limiter.acquire().then((r) => {
      done = true;
      return r;
    });
    await clock.advance(1);
    expect(done).toBe(false);
    await clock.advance(4_000);
    expect(await pending).toBeUndefined();
  });

  it("frees capacity as calls age out of the window", async () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 3; i++) await limiter.acquire();
    await clock.advance(10_001);
    expect(limiter.used).toBe(0);
    expect(await limiter.acquire()).toBeUndefined();
  });

  it("never lets more than `limit` calls through in any window, over a long burst", async () => {
    const { clock, limiter } = make(5, 10_000, 60_000);
    const times: number[] = [];
    const run = (async () => {
      for (let i = 0; i < 40; i++) {
        await limiter.acquire();
        times.push(clock.now());
      }
    })();
    // Let the first calls (admitted at t = 0) record their time before the clock moves.
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 400 && times.length < 40; i++) await clock.advance(500);
    await run;
    expect(times).toHaveLength(40);
    for (let i = 5; i < times.length; i++) {
      // The 6th call after any call is at least one full window later.
      expect((times[i] ?? 0) - (times[i - 5] ?? 0)).toBeGreaterThanOrEqual(10_000);
    }
  });
});

describe("the limiter in the HTTP transport", () => {
  const server = () => {
    let calls = 0;
    const fetchImpl: FetchLike = (url) => {
      calls += 1;
      const body = url.includes("feature-cost")
        ? { status: 200, result: { next_token: calls < 3 ? `p${String(calls)}` : "", skus: [] } }
        : { status: 200, data: { task_id: "t" } };
      return Promise.resolve(new Response(JSON.stringify(body)));
    };
    return { fetchImpl, calls: () => calls };
  };

  it("counts every request, including each page of a paged read", async () => {
    const { limiter } = make(100);
    const s = server();
    const api = new HttpYouCamApi({
      apiKey: "k",
      baseUrl: "https://api.test",
      fetch: s.fetchImpl,
      gate: () => limiter.acquire(),
    });
    await api.getFeatureCosts();
    expect(s.calls()).toBe(3);
    expect(limiter.used).toBe(3);
    await api.createTask({ slug: "sod", version: "v2.0" }, {});
    expect(limiter.used).toBe(4);
  });

  it("does not send a request the limiter refused, and reports it as retryable", async () => {
    const { limiter } = make(1);
    const s = server();
    const api = new HttpYouCamApi({
      apiKey: "k",
      baseUrl: "https://api.test",
      fetch: s.fetchImpl,
      gate: () => limiter.acquire(),
    });
    expect((await api.createTask({ slug: "sod", version: "v2.0" }, {})).ok).toBe(true);
    const second = await api.createTask({ slug: "sod", version: "v2.0" }, {});
    expect(second).toMatchObject({ ok: false, error: { kind: "rate_limited", retryable: true } });
    expect(s.calls()).toBe(1);
  });

  it("an upload to the presigned URL is not counted", async () => {
    const { limiter } = make(1);
    const s = server();
    const api = new HttpYouCamApi({
      apiKey: "k",
      baseUrl: "https://api.test",
      fetch: s.fetchImpl,
      gate: () => limiter.acquire(),
    });
    await api.putBytes(
      { fileId: "f", method: "PUT", url: "https://s3.test/x", headers: {} },
      new Uint8Array([1]),
    );
    expect(limiter.used).toBe(0);
  });
});
