// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { color, motion, radius, space, type } from "../tokens/tokens";

const read = (f: string) => readFileSync(join(import.meta.dirname, "../tokens", f), "utf8");

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--mira-([a-z0-9-]+):\s*([^;]+);/g)) {
    if (m[1] && m[2]) out[m[1]] = m[2].trim().toLowerCase();
  }
  return out;
}

describe("TS tokens match the CSS exactly", () => {
  const css = read("colors.css");
  const light = vars(/:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");
  const dark = vars(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");

  it("light colours", () => {
    for (const [k, v] of Object.entries(color.light)) expect(light[k], k).toBe(v);
  });

  it("dark colours", () => {
    for (const [k, v] of Object.entries(color.dark)) expect(dark[k], k).toBe(v);
  });

  it("every opaque CSS colour token is exported", () => {
    const opaque = Object.entries(light)
      .filter(([, v]) => v.startsWith("#"))
      .map(([k]) => k);
    expect(Object.keys(color.light).sort()).toEqual(opaque.sort());
  });

  it("space, radius, motion and type", () => {
    const sp = vars(read("space.css"));
    for (const [k, v] of Object.entries(space)) expect(sp[`space-${k}`]).toBe(`${String(v)}px`);
    expect(sp["radius-swatch"]).toBe(`${String(radius.swatch)}px`);
    expect(sp["radius-control"]).toBe(`${String(radius.control)}px`);
    expect(sp["radius-panel"]).toBe(`${String(radius.panel)}px`);
    const mo = vars(read("motion.css").split("@media")[0] ?? "");
    for (const [k, v] of Object.entries(motion)) expect(mo[`motion-${k}`]).toBe(`${String(v)}ms`);
    const ty = vars(read("type.css").split("@media")[0] ?? "");
    for (const [k, [size, line]] of Object.entries(type))
      expect(ty[k]).toBe(`${String(size)}px / ${String(line)}px`);
  });
});
