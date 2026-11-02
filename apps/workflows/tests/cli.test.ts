import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClock, createMockPorts } from "@mira/runtime";
import { loadFixtures } from "@mira/fixtures";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { afterEach, describe, expect, it } from "vitest";
import { SMOKE_CASES, askOnTerminal, recordMain, smokeMain, type CliDeps } from "../src/tools/cli";

const PHOTO = new TextEncoder().encode("PRIVATE-FACE-PHOTO-BYTES");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function make(opts: { yes: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "mira-cli-"));
  dirs.push(dir);
  const clock = new FakeClock();
  const fake = new FakeYouCam({
    clock,
    prices: {
      "skin-tone-analysis": 20,
      "fitzpatrick-scale-analyzer": 10,
      "face-attr-analysis": 10,
      "hair-density-detection": 1,
      "hair-length-detection": 2,
      "skin-analysis": 9,
      "skin-simulation": 4,
      sod: 1,
    },
    skus: [
      { slug: "skin-tone-analysis", amount: 20 },
      { slug: "fitzpatrick-scale-analyzer", amount: 10 },
      { slug: "face-attr-analysis", amount: 10 },
      { slug: "hair-density-detection", amount: 1 },
      { slug: "hair-length-detection", amount: 2 },
      { slug: "skin-analysis", amount: 9, description: "AI Skin Analysis for SD 1~4 concerns" },
      { slug: "skin-simulation", amount: 4 },
      { slug: "sod", amount: 1 },
    ],
  });
  fake.respondWith("skin-tone-analysis", {
    latencyMs: 1_000,
    results: { color: { skin_color: "#C79A78" } },
  });
  fake.respondWith("fitzpatrick-scale-analyzer", {
    latencyMs: 1_000,
    results: { fitzpatrick_scale: "II" },
  });
  fake.respondWith("face-attr-analysis", {
    latencyMs: 1_000,
    results: { facialratio: { face_aspect_ratio: [1.3] } },
  });
  fake.respondWith("hair-density-detection", {
    latencyMs: 1_000,
    results: { hair_density: { mapping: "1" } },
  });
  fake.respondWith("hair-length-detection", {
    latencyMs: 1_000,
    results: { hair_length: { term: "long hair" } },
  });
  fake.respondWith("skin-analysis", {
    latencyMs: 1_000,
    results: { output: [{ type: "hd_pore", raw_score: 70 }] },
  });
  fake.respondWith("skin-simulation", {
    latencyMs: 1_000,
    results: { url: "https://r.test/a.png?X-Amz-Signature=s" },
  });
  fake.respondWith("sod", {
    latencyMs: 1_000,
    results: { url: "https://r.test/cut.png?X-Amz-Signature=s&X-Amz-Expires=7200" },
  });
  const lines: string[] = [];
  const asked: string[] = [];
  const deps: CliDeps = {
    api: fake,
    ports: createMockPorts({ clock }),
    download: () =>
      Promise.resolve({
        ok: true as const,
        value: { bytes: new Uint8Array([9, 9]), contentType: "image/png" },
      }),
    confirm: (q) => {
      asked.push(q);
      return Promise.resolve(opts.yes);
    },
    out: (l) => lines.push(l),
    recordedDir: join(dir, "recorded"),
    readFile: () => PHOTO,
    sleep: (ms) => clock.advance(ms),
  };
  return { deps, fake, lines, asked, dir };
}

describe("fixtures:record", () => {
  it("quotes, asks, and when declined spends and writes nothing", async () => {
    const { deps, fake, lines, asked, dir } = make({ yes: false });
    const code = await recordMain(["skin-tone-analysis", "--input", "face.jpg"], deps);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("total");
    expect(lines.join("\n")).toContain("20 units");
    expect(asked).toEqual(["Spend up to 20 units recording skin-tone-analysis?"]);
    expect(lines.at(-1)).toContain("Nothing was submitted");
    expect(fake.callsTo("createTask")).toBe(0);
    expect(fake.callsTo("registerFile")).toBe(0);
    expect(existsSync(join(dir, "recorded"))).toBe(false);
  });

  it("records an analyser through the lifecycle and writes a valid, face-free fixture", async () => {
    const { deps, fake, lines, dir } = make({ yes: true });
    expect(
      await recordMain(["skin-tone-analysis", "--input", "face.jpg", "--name", "tone-1"], deps),
    ).toBe(0);
    expect(fake.callsTo("createTask")).toBe(1);
    const loaded = loadFixtures(join(dir, "recorded"));
    expect(loaded.fixtures).toHaveLength(1);
    expect(loaded.fixtures[0]).toMatchObject({
      feature: "skin-tone-analysis",
      name: "tone-1",
      unitsCharged: 20,
    });
    expect(loaded.skus.find((s) => s.slug === "skin-tone-analysis")?.amount).toBe(20);
    expect(lines.join("\n")).toContain("CONSENT.md");
    // The photo is nowhere on disk under the recordings.
    const everything = JSON.stringify(readdirSync(join(dir, "recorded"), { recursive: true }));
    expect(everything).not.toContain("face.jpg");
    for (const f of readdirSync(join(dir, "recorded"), { recursive: true, withFileTypes: true })) {
      if (f.isFile()) expect(readFileSync(join(f.parentPath, f.name)).includes(PHOTO)).toBe(false);
    }
  });

  it("records an image result: a scrubbed reference and the downloaded file beside it", async () => {
    const { deps, dir } = make({ yes: true });
    expect(await recordMain(["sod", "--input", "face.jpg", "--name", "cut-1"], deps)).toBe(0);
    const fixture = loadFixtures(join(dir, "recorded")).fixtures[0];
    const url = (fixture?.outcome as { results: { url: string } }).results.url;
    expect(url).toMatch(/^fixture:\/\/[0-9a-f]{16}\.png$/);
    const file = join(dir, "recorded", "sod", "files", url.slice("fixture://".length));
    expect([...readFileSync(file)]).toEqual([9, 9]);
    expect(readFileSync(join(dir, "recorded", "sod", "cut-1.json"), "utf8")).not.toContain("X-Amz");
  });

  it("rejects bad input before asking for anything", async () => {
    const { deps, asked, fake } = make({ yes: true });
    expect(await recordMain([], deps)).toBe(2);
    expect(await recordMain(["sod", "--input", "face.gif"], deps)).toBe(2);
    expect(await recordMain(["skin-simulation", "--input", "a.jpg", "--params", "{}"], deps)).toBe(
      2,
    );
    expect(
      await recordMain(["sod", "--input", "a.jpg"], {
        ...deps,
        readFile: () => new Uint8Array(11 * 1024 * 1024),
      }),
    ).toBe(2);
    expect(asked).toEqual([]);
    expect(fake.callsTo("createTask")).toBe(0);
  });

  it("refuses to run without a key (never a silent mock)", async () => {
    const saved = process.env.YOUCAM_API_KEY;
    delete process.env.YOUCAM_API_KEY;
    try {
      expect(await recordMain(["sod", "--input", "a.jpg"], { out: () => undefined })).toBe(2);
    } finally {
      if (saved !== undefined) process.env.YOUCAM_API_KEY = saved;
    }
  });

  it("with no terminal attached, the default prompt answers no", async () => {
    expect(await askOnTerminal("Spend?")).toBe(false);
  });
});

describe("smoke:live", () => {
  it("quotes every feature, asks once, and spends nothing when declined", async () => {
    const { deps, fake, lines, asked } = make({ yes: false });
    expect(await smokeMain(["--input", "face.jpg"], deps)).toBe(0);
    expect(asked).toHaveLength(1);
    expect(lines.filter((l) => /units$/.test(l)).length).toBe(SMOKE_CASES.length + 1);
    expect(fake.callsTo("createTask")).toBe(0);
  });

  it("runs each feature as its own run and reports pass or fail per feature", async () => {
    const { deps, fake, lines } = make({ yes: true });
    fake.respondWith("sod", { latencyMs: 1_000, failWith: "error_inference" });
    expect(await smokeMain(["--input", "face.jpg"], deps)).toBe(1);
    const report = lines.filter((l) => /^(PASS|FAIL) /.test(l));
    expect(report).toHaveLength(SMOKE_CASES.length);
    expect(report.filter((l) => l.startsWith("FAIL"))).toHaveLength(1);
    expect(report.find((l) => l.startsWith("FAIL"))).toContain("sod");
    expect(lines.at(-1)).toBe("1 feature(s) failed.");
    expect(fake.units).toBe(1_000 - (20 + 10 + 10 + 1 + 2 + 9 + 4));
  });

  it("an unpriced feature stops the whole smoke test before anything is spent", async () => {
    const { deps, fake, lines } = make({ yes: true });
    const noPrice = new FakeYouCam({ clock: new FakeClock(), skus: [{ slug: "sod", amount: 1 }] });
    expect(await smokeMain(["--input", "face.jpg"], { ...deps, api: noPrice })).toBe(1);
    expect(lines.join("\n")).toContain("Cannot quote");
    expect(fake.callsTo("createTask")).toBe(0);
    expect(noPrice.callsTo("createTask")).toBe(0);
  });

  it("needs an image", async () => {
    const { deps } = make({ yes: true });
    expect(await smokeMain([], deps)).toBe(2);
    expect(await smokeMain(["--input", "face.bmp"], deps)).toBe(2);
  });
});
