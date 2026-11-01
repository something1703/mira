import { describe, expect, it } from "vitest";
import { makeHarness, youcam } from "./harness";

describe("tolerant nodes", () => {
  const graph = (tolerant: boolean) => ({
    type: "demo" as const,
    nodes: [
      youcam("good", "fitzpatrick-scale-analyzer", { inputs: { src: "blob:runs/seed/a.jpg" } }),
      youcam("bad", "skin-tone-analysis", { inputs: { src: "blob:runs/seed/a.jpg" } }),
      {
        id: "last",
        kind: "system" as const,
        label: "step.last",
        feature: "last",
        dependsOn: ["good", "bad"],
        tolerant,
      },
    ],
  });
  const executors = {
    last: (ctx: { upstream: Record<string, { status: string }> }) =>
      Promise.resolve({
        ok: true as const,
        value: {
          output: {
            seen: Object.fromEntries(Object.entries(ctx.upstream).map(([k, v]) => [k, v.status])),
          },
        },
      }),
  };

  async function run(tolerant: boolean) {
    const h = makeHarness({
      executors,
      prices: { "fitzpatrick-scale-analyzer": 10, "skin-tone-analysis": 20 },
    });
    await h.photo("a");
    h.fake.respondWith("fitzpatrick-scale-analyzer", { results: { fitzpatrick_scale: "III" } });
    h.fake.respondWith("skin-tone-analysis", { failWith: "error_no_face" });
    const id = await h.start(graph(tolerant));
    await h.settle();
    return (await h.nodes(id)).last;
  }

  it("runs after a dependency failed and sees every dependency's status", async () => {
    const last = await run(true);
    expect(last?.status).toBe("done");
    expect(last?.output).toEqual({ seen: { good: "done", bad: "failed" } });
  });

  it("an ordinary node is skipped when a dependency failed", async () => {
    expect((await run(false))?.status).toBe("skipped");
  });
});
