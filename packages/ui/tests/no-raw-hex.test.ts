// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Definition of done, Phase 2: no raw hex colour outside packages/ui/tokens (AGENTS.md §8). */
const ROOT = join(import.meta.dirname, "../../..");
const SCAN = ["packages/ui/src", "apps/web/app", "apps/web/src"];
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
// Colour literals in CSS functions are tokens' job too.
const FUNC = /\b(?:rgb|rgba|hsl|hsla)\(/g;

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe("no raw colours in components", () => {
  for (const rel of SCAN) {
    for (const file of files(join(ROOT, rel)).filter((f) => /\.(css|tsx?)$/.test(f))) {
      it(file.replace(`${ROOT}/`, ""), () => {
        const text = readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
          .join("\n");
        // Data colours (catalogue shades) are passed in as props, never written in source.
        expect(text.match(HEX) ?? [], "hex colour").toEqual([]);
        expect(text.match(FUNC) ?? [], "rgb()/hsl()").toEqual([]);
      });
    }
  }
});
