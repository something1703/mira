import { describe, expect, it } from "vitest";
import { CASES } from "../evals/cases";
import { PASS_RATE, runAll, runCase } from "../evals/run";

describe("the scripted conversations (docs/AGENT_RUNTIME.md §9)", () => {
  it("has at least forty, and covers every module and the named hazards", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    const modules = new Set(CASES.map((c) => c.module));
    for (const m of [
      "twin",
      "shade",
      "look",
      "proof",
      "scope",
      "confirmation",
      "injection",
      "renderer",
      "missing_twin",
      "unavailable",
    ]) {
      expect(modules.has(m as never), m).toBe(true);
    }
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it("passes at least the required rate", async () => {
    const { rate } = await runAll();
    expect(rate).toBeGreaterThanOrEqual(PASS_RATE);
  });

  for (const c of CASES) {
    it(c.id, async () => {
      const r = await runCase(c);
      expect(r.failures).toEqual([]);
    });
  }
});
