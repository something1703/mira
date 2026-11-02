import { FakeClock } from "@mira/runtime";
import { describe, expect, it } from "vitest";
import { Fixture, ReplayYouCam, bodyKey, canonicalJson, scrubUrls, taskPath } from "../src";

const SIGNED =
  "https://yce-us.s3-accelerate.amazonaws.com/ttl30/abc/result.png?X-Amz-Algorithm=AWS4&X-Amz-Expires=7200&X-Amz-Signature=deadbeef";

describe("scrubUrls", () => {
  it("replaces signed URLs with a stable local reference and reports the originals", () => {
    const { value, replaced } = scrubUrls({
      url: SIGNED,
      nested: [{ mask: SIGNED }],
      plain: "https://example.com/a.png",
      n: 3,
    });
    const text = JSON.stringify(value);
    expect(text).not.toContain("X-Amz");
    expect(text).not.toContain("amazonaws");
    expect(text).toContain("https://example.com/a.png");
    const refs = Object.keys(replaced);
    expect(refs).toHaveLength(1); // the same path maps to one reference
    expect(refs[0]).toMatch(/^fixture:\/\/[0-9a-f]{16}\.png$/);
    expect(replaced[refs[0] ?? ""]).toBe(SIGNED);
  });

  it("leaves unsigned values alone", () => {
    const input = { a: [1, "x", null], b: { c: "https://plain.test/x" } };
    expect(scrubUrls(input).value).toEqual(input);
  });
});

describe("bodyKey", () => {
  it("ignores which files were sent but not what was asked", () => {
    const a = bodyKey("skin-analysis", {
      src_file_id: "one",
      dst_actions: ["hd_pore"],
      format: "json",
    });
    const b = bodyKey("skin-analysis", {
      src_file_url: "https://x",
      dst_actions: ["hd_pore"],
      format: "json",
    });
    const c = bodyKey("skin-analysis", {
      src_file_id: "one",
      dst_actions: ["hd_texture"],
      format: "json",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(bodyKey("sod", {})).not.toBe(bodyKey("skin-analysis", {}));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("ReplayYouCam", () => {
  const clock = new FakeClock();
  const feature = { slug: "skin-tone-analysis", version: "v2.0" } as const;
  const body = { src_file_id: "x", face_angle_strictness_level: "high" };
  const fixture = Fixture.parse({
    feature: feature.slug,
    version: feature.version,
    name: "tone-1",
    recordedAt: "2026-11-01T10:00:00.000Z",
    key: bodyKey(feature.slug, body),
    latencyMs: 8_000,
    outcome: { status: "success", results: { color: { skin_color: "#C79A78" } } },
    unitsCharged: 20,
  });
  const failure = Fixture.parse({
    ...fixture,
    name: "tone-fail",
    key: bodyKey(feature.slug, { face_angle_strictness_level: "strict" }),
    outcome: { status: "error", error: "error_lighting_dark" },
    unitsCharged: 0,
  });
  const make = () =>
    new ReplayYouCam({
      clock,
      fixtures: [fixture, failure],
      skus: [{ slug: feature.slug, amount: 20 }],
      units: 100,
    });

  it("replays a recording after its recorded latency, scaled down", async () => {
    const api = make();
    const created = await api.createTask(feature, {
      src_file_id: "different-file-id",
      face_angle_strictness_level: "high",
    });
    if (!created.ok) throw new Error("setup");
    expect(await api.getTask(feature, created.value.taskId)).toEqual({
      ok: true,
      value: { status: "running" },
    });
    await clock.advance(2_001); // 8 000 ms × 0.25
    expect(await api.getTask(feature, created.value.taskId)).toMatchObject({
      ok: true,
      value: { status: "success", results: { color: { skin_color: "#C79A78" } } },
    });
    expect(api.units).toBe(80);
  });

  it("replays a recorded failure with its mapped code and no charge", async () => {
    const api = make();
    const created = await api.createTask(feature, {
      src_file_id: "z",
      face_angle_strictness_level: "strict",
    });
    if (!created.ok) throw new Error("setup");
    await clock.advance(10_000);
    expect(await api.getTask(feature, created.value.taskId)).toMatchObject({
      ok: true,
      value: { status: "error", error: { code: "too_dark", guidance: "retake", unitsCharged: 0 } },
    });
    expect(api.units).toBe(100);
  });

  it("refuses a request it has no recording for instead of inventing a result", async () => {
    const api = make();
    const res = await api.createTask(feature, {
      src_file_id: "x",
      face_angle_strictness_level: "low",
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: "no_recording", retryable: false, unitsCharged: 0 },
    });
  });

  it("serves the recorded prices, a balance and a path helper", async () => {
    const api = make();
    expect(await api.getFeatureCosts()).toEqual({
      ok: true,
      value: [{ slug: feature.slug, amount: 20 }],
    });
    expect(await api.getCredit()).toMatchObject({ ok: true, value: { units: 100 } });
    expect((await api.registerFile({ contentType: "image/jpeg" })).ok).toBe(true);
    expect((await api.putBytes()).ok).toBe(true);
    expect(taskPath(feature)).toBe("/s2s/v2.0/task/skin-tone-analysis");
    expect((await api.deleteTask("anything")).ok).toBe(true);
  });
});
