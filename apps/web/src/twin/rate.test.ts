import { describe, expect, it } from "vitest";
import { RateLimit } from "./rate";

describe("RateLimit", () => {
  it("allows up to the limit in a window, then refuses until the window passes", () => {
    let now = 0;
    const limit = new RateLimit(2, 1_000, () => now);
    expect([limit.take("a"), limit.take("a"), limit.take("a")]).toEqual([true, true, false]);
    now = 999;
    expect(limit.take("a")).toBe(false);
    now = 1_000;
    expect(limit.take("a")).toBe(true);
  });

  it("counts each key on its own", () => {
    const limit = new RateLimit(1, 1_000, () => 0);
    expect([limit.take("a"), limit.take("b"), limit.take("a")]).toEqual([true, true, false]);
  });
});
