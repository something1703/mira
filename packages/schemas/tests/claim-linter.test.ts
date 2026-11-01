import { describe, expect, it } from "vitest";
import { DISCLAIMER, isClean, isExempt, lintText } from "../src/claim-linter";

const ids = (text: string) => lintText(text).map((v) => v.ruleId);

describe("claim linter: banned stems are caught", () => {
  it.each([
    ["Clinically proven to reduce pores.", ["clinical", "proven-to"]],
    ["This serum treats redness.", ["treat"]],
    ["A treatment for dark circles", ["treat"]],
    ["We diagnose your skin", ["diagnose"]],
    ["Healing serum", ["heal"]],
    ["Cures dryness", ["cure"]],
    ["Your skin condition looks better", ["condition"]],
    ["the condition of your skin", ["condition"]],
    ["Hide every flaw", ["flaw"]],
    ["flawless finish", ["flaw"]],
    ["Imperfections fade", ["imperfection"]],
    ["Target problem areas", ["problem-area"]],
    ["Fix your undertone", ["fix-your"]],
    ["anti-aging cream", ["anti-ageing"]],
    ["Anti ageing", ["anti-ageing"]],
    ["Get perfect skin", ["perfect-skin"]],
    ["Unattractive shine", ["attractive"]],
    ["Guaranteed match", ["guaranteed"]],
    ["100% accurate", ["100-percent"]],
    ["Scientifically proven", ["scientifically-proven"]],
    ["It always works", ["always-works"]],
    ["Dermatologist-approved formula", ["dermatologist-approved"]],
    ["reduces inflammation and eczema", ["inflammation", "eczema"]],
    ["MEDICAL GRADE", ["medical"]],
  ])("%s", (text, expected) => {
    expect(ids(text)).toEqual(expected);
  });
});

describe("claim linter: allowed cosmetic framing passes", () => {
  it.each([
    "The scan measured visible pores.",
    "The appearance of redness looks lower than your day-to-day variation.",
    "This shade reads warmer than your skin.",
    "Face a window or a lamp so your face is evenly lit.",
    "Even lighting conditions make readings steadier.",
    "Uploading securely",
    "Your health and privacy matter: images are deleted after measuring.",
    "Perfect Corp's YouCam API",
    "Verified: lip colour within ΔE {de} of the product.",
    "Units come from your session allowance.",
    "Retreat venue",
    "Accurate to 1100%? no — 2100 % is not banned either",
  ])("%s", (text) => {
    expect(lintText(text)).toEqual([]);
  });
});

describe("claim linter: scope rules", () => {
  it("allowlists the exact disclaimer sentence", () => {
    expect(isClean(`Before you start. ${DISCLAIMER} Tick the box to continue.`)).toBe(true);
  });

  it("still catches banned words next to the disclaimer", () => {
    expect(ids(`${DISCLAIMER} It treats acne.`)).toEqual(["treat"]);
  });

  it("does not allowlist a paraphrase of the disclaimer", () => {
    expect(isClean("MIRA does not diagnose anything.")).toBe(false);
  });

  it("reports line and column of each match", () => {
    const [v] = lintText("first line\nsecond: heal");
    expect(v).toMatchObject({ line: 2, column: 9, match: "heal" });
  });

  it("exempts prompts, refusal templates and tests", () => {
    expect(isExempt("apps/agent/src/prompts/system.v1.md")).toBe(true);
    expect(isExempt("apps/agent/src/fallbacks.ts")).toBe(true);
    expect(isExempt("apps/web/app/page.test.tsx")).toBe(true);
    expect(isExempt("apps/web/app/page.tsx")).toBe(false);
    expect(isExempt("README.md")).toBe(false);
  });
});
