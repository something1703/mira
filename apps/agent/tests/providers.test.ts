import { Answer } from "@mira/schemas";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiSdkProvider } from "../src/providers/ai-sdk";
import { MockProvider } from "../src/providers/mock";
import { selectProvider } from "../src/providers/select";
import { SPECS } from "../src/tools";

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
};
const model = (content: unknown[], finish: "stop" | "tool-calls" = "stop", fail?: Error) =>
  new MockLanguageModelV4({
    doGenerate: () => {
      if (fail) return Promise.reject(fail);
      return Promise.resolve({
        content,
        finishReason: { unified: finish, raw: finish },
        usage,
        warnings: [],
      } as never);
    },
  });

describe("the AI SDK adapter", () => {
  it("reports the model's tool calls without running them", async () => {
    const main = model(
      [{ type: "tool-call", toolCallId: "c1", toolName: "get_twin_summary", input: "{}" }],
      "tool-calls",
    );
    const p = new AiSdkProvider("test", { main, small: main });
    const r = await p.generate({
      purpose: "step",
      system: "s",
      messages: [{ role: "user", text: "hi" }],
      tools: [...SPECS],
    });
    expect(r).toMatchObject({
      ok: true,
      value: { kind: "tools", calls: [{ id: "c1", name: "get_twin_summary", input: {} }] },
    });
    // The tools it was given had no way to run themselves.
    const sent = main.doGenerateCalls[0]?.tools ?? [];
    expect(sent.map((t) => t.name)).toContain("start_run");
  });

  it("returns structured output for the answer", async () => {
    const value = {
      segments: [{ text: "Hello.", metric_refs: [] }],
      renders: [],
      next_actions: [],
    };
    const main = model([{ type: "text", text: JSON.stringify(value) }]);
    const p = new AiSdkProvider("test", { main, small: main });
    const r = await p.generate({
      purpose: "answer",
      system: "s",
      messages: [{ role: "user", text: "hi" }],
      schema: Answer,
    });
    expect(r).toMatchObject({ ok: true, value: { kind: "object", value } });
  });

  it("hands back text that does not match, so the renderer can show the model the problem", async () => {
    const main = model([{ type: "text", text: '{"segments": "wrong"}' }]);
    const p = new AiSdkProvider("test", { main, small: main });
    const r = await p.generate({
      purpose: "answer",
      system: "s",
      messages: [{ role: "user", text: "hi" }],
      schema: Answer,
    });
    expect(r).toMatchObject({ ok: true, value: { kind: "text", text: '{"segments": "wrong"}' } });
  });

  it("uses the small model for extraction and the main model otherwise", async () => {
    const main = model([{ type: "text", text: "{}" }]);
    const small = model([{ type: "text", text: '{"a":1}' }]);
    const p = new AiSdkProvider("test", { main, small });
    await p.generate({
      purpose: "extract",
      system: "s",
      messages: [{ role: "user", text: "page" }],
      schema: z.object({ a: z.number() }),
    });
    expect(small.doGenerateCalls).toHaveLength(1);
    expect(main.doGenerateCalls).toHaveLength(0);
  });

  it("sends earlier tool calls and results back in the shape the SDK expects", async () => {
    const main = model([{ type: "text", text: "ok" }]);
    const p = new AiSdkProvider("test", { main, small: main });
    await p.generate({
      purpose: "step",
      system: "s",
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "", calls: [{ id: "c1", name: "get_twin_summary", input: {} }] },
        { role: "tool", callId: "c1", name: "get_twin_summary", result: { status: "no_profile" } },
      ],
      tools: [...SPECS],
    });
    const prompt = JSON.stringify(main.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("tool-call");
    expect(prompt).toContain("tool-result");
  });

  it("reports an unreachable model as unavailable", async () => {
    const main = model([], "stop", new Error("503 from the model"));
    const p = new AiSdkProvider("test", { main, small: main });
    const r = await p.generate({
      purpose: "step",
      system: "s",
      messages: [{ role: "user", text: "hi" }],
      tools: [],
    });
    expect(r).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
});

describe("choosing the provider by environment", () => {
  const env = (o: Record<string, string>) => ({
    MIRA_MODEL_MAIN: "model-main",
    MIRA_MODEL_SMALL: "model-small",
    GOOGLE_CLOUD_PROJECT: "mira-test",
    GOOGLE_CLOUD_REGION: "europe-west4",
    ...o,
  });

  it("builds each adapter from configuration alone", () => {
    expect(selectProvider(env({ MIRA_MODEL_PROVIDER: "mock" }))).toBeInstanceOf(MockProvider);
    for (const name of ["vertex-google", "vertex-anthropic"] as const) {
      const p = selectProvider(env({ MIRA_MODEL_PROVIDER: name }));
      expect(p).toBeInstanceOf(AiSdkProvider);
      expect(p.name).toBe(name);
    }
    const direct = selectProvider(
      env({ MIRA_MODEL_PROVIDER: "anthropic-direct", ANTHROPIC_API_KEY: "test-key" }),
    );
    expect(direct.name).toBe("anthropic-direct");
  });

  it("defaults to the mock and refuses a real provider with no model id", () => {
    expect(selectProvider({})).toBeInstanceOf(MockProvider);
    expect(() => selectProvider({ MIRA_MODEL_PROVIDER: "vertex-google" })).toThrow(
      /MIRA_MODEL_MAIN/,
    );
  });
});
