import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "../src/claim-linter";
import { extractStrings, lintRepo } from "../scripts/lint-claims";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mira-claims-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("lint-claims CLI", () => {
  it("fails on 'clinically proven' in a web component (phase 1 acceptance)", () => {
    const root = repo({
      "apps/web/app/page.tsx": `export default function P() {\n  return <p>Clinically proven results</p>;\n}\n`,
    });
    const findings = lintRepo(root);
    expect(findings.map((f) => f.ruleId)).toEqual(["clinical"]);
    expect(findings[0]).toMatchObject({ file: "apps/web/app/page.tsx", line: 2 });
  });

  it("checks string literals, template text and JSX attributes, not identifiers", () => {
    const root = repo({
      "packages/ui/src/copy.tsx": [
        "const treatment = 1; // identifier, not copy",
        'export const a = "Hide every flaw";',
        "export const b = `Guaranteed ${treatment} match`;",
        'export const c = <img alt="flawless skin" />;',
      ].join("\n"),
    });
    expect(lintRepo(root).map((f) => f.ruleId)).toEqual(["flaw", "guaranteed", "flaw"]);
  });

  it("ignores import paths", () => {
    expect(extractStrings("x.ts", 'import x from "./treatment-plan";').map((s) => s.text)).toEqual(
      [],
    );
  });

  it("lints the README in full but allowlists the disclaimer", () => {
    expect(lintRepo(repo({ "README.md": `# MIRA\n\n${DISCLAIMER}\n` }))).toEqual([]);
    expect(lintRepo(repo({ "README.md": "Heals your skin." }))).toHaveLength(1);
  });

  it("exempts prompts and refusal templates", () => {
    const root = repo({
      "apps/agent/src/prompts/system.v1.md": "Never diagnose.",
      "apps/agent/src/fallbacks.ts": 'export const r = "cannot help with medical questions";',
      "apps/agent/src/answer.ts": 'export const r = "cannot help with medical questions";',
    });
    expect(lintRepo(root).map((f) => f.file)).toEqual(["apps/agent/src/answer.ts"]);
  });

  it("lints Skill docs", () => {
    expect(lintRepo(repo({ "skills/x/SKILL.md": "Finds a flawless match." }))).toHaveLength(1);
  });
});
