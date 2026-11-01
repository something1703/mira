import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureDownloader, fixtureFilePath, hasRecordings, loadFixtures } from "../src";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "mira-fx-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const fixture = {
  feature: "sod",
  version: "v2.0",
  name: "cutout-1",
  recordedAt: "2026-11-01T10:00:00.000Z",
  key: "k".repeat(64),
  latencyMs: 4000,
  outcome: { status: "success", results: { url: "fixture://0123456789abcdef.png" } },
  unitsCharged: 1,
};

describe("loadFixtures", () => {
  it("an empty or missing folder is nothing recorded, not an error", () => {
    expect(loadFixtures(join(tmp(), "nope"))).toEqual({ fixtures: [], skus: [] });
    expect(hasRecordings(tmp())).toBe(false);
  });

  it("reads fixtures per feature and the cost snapshot", () => {
    const dir = tmp();
    mkdirSync(join(dir, "sod"));
    writeFileSync(join(dir, "sod", "cutout-1.json"), JSON.stringify(fixture));
    writeFileSync(
      join(dir, "feature-cost.json"),
      JSON.stringify([{ slug: "sod", amount: 1, unit: "result_image" }]),
    );
    const out = loadFixtures(dir);
    expect(out.fixtures.map((f) => f.name)).toEqual(["cutout-1"]);
    expect(out.skus).toEqual([{ slug: "sod", amount: 1, unit: "result_image" }]);
    expect(hasRecordings(dir)).toBe(true);
  });

  it("a malformed fixture fails loudly rather than being skipped", () => {
    const dir = tmp();
    mkdirSync(join(dir, "sod"));
    writeFileSync(join(dir, "sod", "bad.json"), JSON.stringify({ feature: "sod" }));
    expect(() => loadFixtures(dir)).toThrow();
  });

  it("the committed recorded folder is valid (empty until someone records)", () => {
    expect(() => loadFixtures()).not.toThrow();
  });
});

describe("fixtureDownloader", () => {
  it("serves a recorded file and refuses anything else", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "sod", "files"), { recursive: true });
    writeFileSync(join(dir, "sod", "files", "0123456789abcdef.png"), new Uint8Array([1, 2, 3]));
    const dl = fixtureDownloader(dir);
    expect(await dl("fixture://0123456789abcdef.png")).toEqual({
      ok: true,
      value: { bytes: Buffer.from([1, 2, 3]), contentType: "image/png" },
    });
    expect(await dl("fixture://ffffffffffffffff.png")).toMatchObject({ ok: false });
    expect(await dl("https://evil.test/x.png")).toMatchObject({ ok: false });
    expect(await dl("fixture://../../etc/passwd")).toMatchObject({ ok: false });
  });

  it("maps a reference to its path only when well formed", () => {
    expect(fixtureFilePath("fixture://0123456789abcdef.png", "sod", "/r")).toBe(
      "/r/sod/files/0123456789abcdef.png",
    );
    expect(fixtureFilePath("fixture://nope", "sod", "/r")).toBeUndefined();
  });
});
