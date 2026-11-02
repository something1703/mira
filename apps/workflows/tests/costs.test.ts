import { FakeClock } from "@mira/runtime";
import { CONFIG } from "@mira/schemas";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { describe, expect, it } from "vitest";
import { BalanceCache, FeatureCostCache } from "../src/lifecycle/costs";
import { pollDelayMs } from "../src/lifecycle/node-lifecycle";

const HOUR = 3_600_000;

function setup() {
  const clock = new FakeClock();
  const fake = new FakeYouCam({ clock, prices: { sod: 1 }, startingUnits: 100 });
  return {
    clock,
    fake,
    costs: new FeatureCostCache(fake, clock),
    balance: new BalanceCache(fake, clock),
  };
}

describe("feature-cost cache: refreshed daily", () => {
  it("reads once and serves the same prices for 24 hours", async () => {
    const { clock, fake, costs } = setup();
    await costs.get();
    await clock.advance(23 * HOUR);
    await costs.get();
    expect(fake.callsTo("getFeatureCosts")).toBe(1);
    expect(CONFIG.youcam.featureCostCacheHours.value).toBe(24);
  });

  it("refreshes after 24 hours and reports when it last priced", async () => {
    const { clock, fake, costs } = setup();
    await costs.get();
    const first = costs.pricedAt;
    await clock.advance(24 * HOUR + 1);
    await costs.get();
    expect(fake.callsTo("getFeatureCosts")).toBe(2);
    expect(costs.pricedAt).toBeGreaterThan(first);
  });

  it("keeps using yesterday's prices when the refresh fails, rather than losing the ability to quote", async () => {
    const { clock, fake, costs } = setup();
    const before = await costs.get();
    await clock.advance(25 * HOUR);
    fake.failNetworkNext(1);
    const after = await costs.get();
    expect(after).toEqual(before);
    expect(fake.callsTo("getFeatureCosts")).toBe(2);
  });

  it("fails honestly on the very first read if it cannot reach YouCam", async () => {
    const { fake, costs } = setup();
    fake.failNetworkNext(1);
    expect(await costs.get()).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(costs.pricedAt).toBe(0);
  });
});

describe("balance cache", () => {
  it("re-reads at most every 15 seconds, because polls share a rate budget", async () => {
    const { clock, fake, balance } = setup();
    await balance.get();
    await clock.advance(14_000);
    await balance.get();
    expect(fake.callsTo("getCredit")).toBe(1);
    await clock.advance(1_001);
    await balance.get();
    expect(fake.callsTo("getCredit")).toBe(2);
  });

  it("invalidate forces a fresh read, as after a task settles", async () => {
    const { fake, balance } = setup();
    await balance.get();
    balance.invalidate();
    await balance.get();
    expect(fake.callsTo("getCredit")).toBe(2);
  });

  it("an error is not cached", async () => {
    const { fake, balance } = setup();
    fake.failNetworkNext(1);
    expect((await balance.get()).ok).toBe(false);
    expect((await balance.get()).ok).toBe(true);
    expect(fake.callsTo("getCredit")).toBe(2);
  });
});

describe("poll backoff", () => {
  it("starts at 2 s, grows 1.5× and is capped at 15 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(pollDelayMs)).toEqual([
      2_000, 3_000, 4_500, 6_750, 10_125, 15_000, 15_000, 15_000,
    ]);
  });

  it("is non-decreasing and never exceeds the cap", () => {
    let prev = 0;
    for (let n = 0; n < 50; n++) {
      const d = pollDelayMs(n);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThanOrEqual(CONFIG.youcam.pollMaxMs.value);
      prev = d;
    }
  });

  it("the total wait before giving up is the configured 10 minutes, well inside YouCam's retention", () => {
    expect(CONFIG.youcam.pollGiveUpMs.value).toBe(600_000);
    expect(CONFIG.youcam.pollGiveUpMs.value).toBeLessThan(
      CONFIG.youcam.resultRetentionHours.value * HOUR,
    );
  });
});
