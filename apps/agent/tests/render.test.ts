import type { Answer, MetricStore } from "@mira/schemas";
import { lintText } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import { makeTwin } from "../evals/harness";
import { fallbackAnswer, renderFallback } from "../src/fallbacks";
import { produceAnswer } from "../src/loop";
import { MockProvider, type MockScript } from "../src/providers/mock";
import { inject, inline } from "../src/render/inject";
import { checkAnswer, checkText, parseAnswer } from "../src/render/validate";

const store: MetricStore = makeTwin().metrics;
const seg = (text: string, metric_refs: string[] = []) => ({ text, metric_refs });
const answer = (...segments: Answer["segments"]): Answer => ({
  segments,
  renders: [],
  next_actions: [],
});

describe("digit and placeholder checks", () => {
  it("accepts plain words and a listed, known placeholder", () => {
    expect(checkText("Your skin colour is {colour.skin}.", ["colour.skin"], store)).toEqual([]);
  });

  it.each([
    ["ASCII digit", "About 3 shades"],
    ["full-width digit", "Shade ３"],
    ["superscript", "Shade ²"],
    ["vulgar fraction", "Shade ½"],
    ["Arabic-Indic digit", "Shade ٣"],
    ["Devanagari digit", "Shade ३"],
  ])("rejects a %s", (_name, text) => {
    expect(checkText(text, [], store).map((p) => p.code)).toContain("digit");
  });

  it.each(["three shades", "forty percent", "a dozen", "per cent", "Twenty"])(
    "rejects the number written out: %s",
    (text) => {
      expect(checkText(text, [], store).map((p) => p.code)).toContain("number_word");
    },
  );

  it("allows 'one', which is not a quantity the model can invent a measurement with", () => {
    expect(checkText("one reading", [], store)).toEqual([]);
  });

  it("rejects a placeholder that is not listed, unknown, malformed, or stray", () => {
    expect(checkText("{colour.skin}", [], store)[0]?.code).toBe("placeholder_unlisted");
    expect(checkText("{colour.lip}", ["colour.lip"], store)[0]?.code).toBe("placeholder_unknown");
    expect(checkText("{Not An Id}", [], store)[0]?.code).toBe("placeholder_malformed");
    expect(checkText("closing } only", [], store)[0]?.code).toBe("stray_brace");
  });

  it("does not hide digits inside braces: only a valid metric id passes", () => {
    expect(checkText("{colour.skin 3}", ["colour.skin"], store).length).toBeGreaterThan(0);
  });
});

describe("parsing the model's answer", () => {
  it("reads an object or JSON text, and says what is wrong otherwise", () => {
    const good = answer(seg("Hello."));
    expect(parseAnswer(good).ok).toBe(true);
    expect(parseAnswer(JSON.stringify(good)).ok).toBe(true);
    const bad = parseAnswer("not json at all");
    expect(!bad.ok && bad.problem.code).toBe("not_json");
    const shape = parseAnswer({ segments: [] });
    expect(!shape.ok && shape.problem.code).toBe("schema");
  });

  it("refuses a segment over the length limit", () => {
    expect(parseAnswer(answer(seg("x".repeat(401)))).ok).toBe(false);
  });
});

describe("metric injection", () => {
  it("fills the value, unit and confidence words from the store", () => {
    const [s] = inject(
      answer(seg("Visible pores read {skin.hd_pore.whole}.", ["skin.hd_pore.whole"])),
      store,
    );
    expect(s?.text).toBe("Visible pores read 41.3 out of 100 (measured once).");
    expect(s?.readings[0]).toMatchObject({ id: "skin.hd_pore.whole", value: "41.3" });
  });

  it("renders a colour as its hex code and a category as its word", () => {
    expect(inline(store["colour.skin"] as never)).toBe("#C79A78");
    expect(inline(store["colour.skin_ita_band"] as never)).toBe("intermediate");
  });
});

describe("fallbacks", () => {
  it("has a sentence per next action, built from fixed text and metric placeholders", () => {
    const f = fallbackAnswer(["match_shade", "build_twin"], store);
    expect(checkAnswer(f, store)).toEqual([]);
    expect(renderFallback(["match_shade"], store).segments[0]?.text).toContain("#C79A78");
  });

  it("does not cite a colour the profile lacks", () => {
    const f = renderFallback(["match_shade"], {});
    expect(f.segments[0]?.text).not.toContain("{");
    expect(checkAnswer(f.answer, {})).toEqual([]);
  });

  it("falls back to one generic line with no actions", () => {
    expect(fallbackAnswer([], store).segments).toHaveLength(1);
  });
});

describe("the answer pipeline", () => {
  const run = async (script: MockScript) => {
    const provider = new MockProvider(script);
    const out = await produceAnswer(provider, "sys", [{ role: "user", text: "hi" }], store, [
      "match_shade",
    ]);
    return { out, provider };
  };

  it("shows a valid answer", async () => {
    const { out } = await run([
      { answer: answer(seg("Your skin colour is {colour.skin}.", ["colour.skin"])) },
    ]);
    expect(out.fallback).toBe(false);
    expect(out.segments[0]?.text).toBe("Your skin colour is #C79A78.");
  });

  it("retries once with the problem shown to the model", async () => {
    const { out, provider } = await run([
      { answer: answer(seg("It is 3 shades off.")) },
      { answer: answer(seg("It is a close match.")) },
    ]);
    expect(out.fallback).toBe(false);
    expect(out.segments[0]?.text).toBe("It is a close match.");
    const retry = provider.requests[1]?.messages.at(-1);
    expect(retry).toMatchObject({ role: "user" });
    expect(JSON.stringify(retry)).toContain("refused");
  });

  it("falls back after two refusals, and never shows the refused text", async () => {
    const { out } = await run([
      { answer: answer(seg("It is 3 shades off.")) },
      { answer: answer(seg("It is guaranteed to match.")) },
    ]);
    expect(out.fallback).toBe(true);
    const shown = out.segments.map((s) => s.text).join(" ");
    expect(shown).not.toMatch(/guaranteed|3/);
  });

  it("runs the claim linter on the rendered text", async () => {
    const { out } = await run([
      { answer: answer(seg("This will treat your skin.")) },
      { answer: answer(seg("This will treat your skin.")) },
    ]);
    expect(out.fallback).toBe(true);
  });

  it("falls back when the model cannot be reached for the answer", async () => {
    const { out } = await run([{ fail: "unavailable" }]);
    expect(out).toMatchObject({ fallback: true, unavailable: true });
  });

  it("shows only plates that exist", async () => {
    const provider = new MockProvider([
      { answer: { ...answer(seg("Done.")), renders: ["render-1", "render-99"] } },
    ]);
    const out = await produceAnswer(provider, "s", [], store, [], ["render-1"]);
    expect(out.renders).toEqual(["render-1"]);
  });
});

// ---- fuzz: no digit from model text ever reaches the UI --------------------------------------

/** A small seeded generator, so a failure can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PIECES = [
  "Your skin",
  "reads as",
  "close to",
  "the shade",
  "12",
  "3.5",
  "٣",
  "٤٥",
  "४",
  "½",
  "²",
  "①",
  "three",
  "forty",
  "percent",
  "100%",
  "{colour.skin}",
  "{skin.hd_pore.whole}",
  "{made.up}",
  "{",
  "}",
  "{}",
  "{colour.skin 4}",
  "ΔE",
  "0",
  "one",
  "tw0",
  "l33t",
  "x2",
  "2x",
  "٠",
  "٠",
  "日本語3",
  "guaranteed",
  "treat",
  "flawless",
  "😀",
  "\n",
  "  ",
  "",
];

describe("fuzz: no digit from model free text reaches the UI", () => {
  it("holds over 1,000 synthetic outputs", async () => {
    const rand = rng(20261101);
    // The only digits allowed on screen are the ones the metric store injects.
    const injected = Object.values(store).map((m) => inline(m));
    const strip = (text: string) => injected.reduce((t, i) => t.split(i).join(" "), text);
    let shownModelText = 0;
    let fellBack = 0;
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(rand() * 8);
      const text = Array.from({ length: n }, () => PIECES[Math.floor(rand() * PIECES.length)]).join(
        " ",
      );
      const refs = rand() < 0.7 ? ["colour.skin", "skin.hd_pore.whole"] : [];
      const out = await produceAnswer(
        new MockProvider([
          { answer: answer(seg(text.slice(0, 400), refs)) },
          { answer: answer(seg(text.slice(0, 400), refs)) },
        ]),
        "s",
        [],
        store,
        ["match_shade"],
      );
      const shown = out.segments.map((s) => strip(s.text)).join("\n");
      expect(shown, `output ${String(i)}: ${text}`).not.toMatch(/\p{N}/u);
      expect(shown).not.toMatch(/[{}]/);
      expect(lintText(out.segments.map((s) => s.text).join("\n"))).toEqual([]);
      if (out.fallback) fellBack++;
      else shownModelText++;
    }
    // The fuzz must exercise both paths, or it proves nothing.
    expect(shownModelText).toBeGreaterThan(0);
    expect(fellBack).toBeGreaterThan(0);
  });
});
