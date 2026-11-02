import { describe, expect, it } from "vitest";
import {
  COUNTING_MS,
  STEADY_MS,
  SteadyTracker,
  instructionFor,
  qualityChecks,
  ringView,
} from "./bridge";
import { Captured, FaceQuality, cameraFailure, imageToBlob } from "./types";

const good = { hasFace: true, position: "good", frontal: "good", lighting: "good" } as const;

describe("qualityChecks", () => {
  it("maps lighting, position and frontal to the Ring's lighting, distance and angle", () => {
    expect(qualityChecks(good)).toEqual({ lighting: true, distance: true, angle: true });
    expect(qualityChecks({ ...good, position: "toosmall" }).distance).toBe(false);
    expect(qualityChecks({ ...good, frontal: "notgood" }).angle).toBe(false);
    expect(qualityChecks({ ...good, lighting: "notgood" }).lighting).toBe(false);
  });

  it("accepts ok lighting, and passes nothing when there is no face", () => {
    expect(qualityChecks({ ...good, lighting: "ok" }).lighting).toBe(true);
    expect(qualityChecks({ ...good, hasFace: false })).toEqual({
      lighting: false,
      distance: false,
      angle: false,
    });
  });
});

describe("instructionFor", () => {
  it("names one failing check in plain words, and nothing when all hold", () => {
    expect(instructionFor(good)).toBeUndefined();
    expect(instructionFor({ hasFace: false })).toBe("Bring your face into the frame.");
    expect(instructionFor({ ...good, position: "toosmall" })).toBe("Move a little closer.");
    expect(instructionFor({ ...good, position: "notgood" })).toBe("Move back a little.");
    expect(instructionFor({ ...good, position: "outofboundary" })).toBe(
      "Centre your face in the frame.",
    );
    expect(instructionFor({ ...good, frontal: "notgood" })).toBe("Look straight at the camera.");
    expect(instructionFor({ ...good, lighting: "notgood" })).toBe(
      "Face a window or a lamp so your face is evenly lit.",
    );
  });

  it("asks in Camera Kit's own order when several fail: lighting, angle, then distance", () => {
    const all = {
      hasFace: true,
      position: "toosmall",
      frontal: "notgood",
      lighting: "notgood",
    } as const;
    expect(instructionFor(all)).toBe("Face a window or a lamp so your face is evenly lit.");
    expect(instructionFor({ ...all, lighting: "good" })).toBe("Look straight at the camera.");
    expect(instructionFor({ ...all, lighting: "good", frontal: "good" })).toBe(
      "Move a little closer.",
    );
  });
});

describe("SteadyTracker", () => {
  it("lights steadiness only after the checks have held for STEADY_MS, and resets on a miss", () => {
    const t = new SteadyTracker();
    expect(t.update(true, 1_000)).toEqual({ steady: false, heldMs: 0 });
    expect(t.update(true, 1_000 + STEADY_MS - 1).steady).toBe(false);
    expect(t.update(true, 1_000 + STEADY_MS)).toEqual({ steady: true, heldMs: STEADY_MS });
    expect(t.update(false, 5_000)).toEqual({ steady: false, heldMs: 0 });
    expect(t.update(true, 6_000).heldMs).toBe(0);
  });
});

describe("ringView", () => {
  it("is idle with no checks and one instruction while something fails", () => {
    const v = ringView({ ...good, position: "toosmall" }, { steady: false, heldMs: 0 });
    expect(v.checks).toEqual({ lighting: true, distance: false, angle: true, steadiness: false });
    expect(v.instruction).toBe("Move a little closer.");
    expect(v.capturing).toBe(false);
  });

  it("is capturing with a countdown once everything has held", () => {
    const v = ringView(good, { steady: true, heldMs: STEADY_MS });
    expect(v.checks).toEqual({ lighting: true, distance: true, angle: true, steadiness: true });
    expect(v.capturing).toBe(true);
    expect(v.countdown).toBe(Math.ceil((COUNTING_MS - STEADY_MS) / 1000));
    expect(v.instruction).toBeUndefined();
    expect(ringView(good, { steady: true, heldMs: COUNTING_MS + 500 }).countdown).toBe(1);
  });

  it("never lights steadiness if a check fails, whatever the tracker says", () => {
    expect(
      ringView({ ...good, frontal: "notgood" }, { steady: true, heldMs: 5_000 }).checks.steadiness,
    ).toBe(false);
  });
});

describe("SDK payloads are untrusted", () => {
  it("parses a quality event and ignores unknown fields", () => {
    expect(FaceQuality.parse({ ...good, pose: { yaw: 1 }, size: 2 })).toMatchObject(good);
    expect(FaceQuality.safeParse({ position: "far away" }).success).toBe(false);
  });

  it("requires at least one image of a known size in a capture", () => {
    expect(Captured.safeParse({ images: [] }).success).toBe(false);
    expect(Captured.safeParse({ images: [{ image: "abc", width: 0, height: 10 }] }).success).toBe(
      false,
    );
    expect(
      Captured.safeParse({
        mode: "hdskincare",
        images: [{ phase: "front", image: "abc", width: 1080, height: 1440 }],
      }).success,
    ).toBe(true);
  });

  it("classifies camera failures from the SDK's strings", () => {
    expect(cameraFailure("error_permission_denied")).toBe("permission_denied");
    expect(cameraFailure({ code: "NotAllowedError" })).toBe("permission_denied");
    expect(cameraFailure("error_resolution_unsupported")).toBe("resolution_unsupported");
    expect(cameraFailure("error_access_failed")).toBe("access_failed");
    expect(cameraFailure(undefined)).toBe("access_failed");
  });

  it("turns a Blob, a data URL or bare base64 into a Blob, and rejects garbage", async () => {
    const jpeg = Uint8Array.from([255, 216, 255, 224]);
    const b64 = btoa(String.fromCharCode(...jpeg));
    const blob = new Blob([jpeg], { type: "image/jpeg" });
    expect(imageToBlob(blob)).toBe(blob);
    const fromUrl = imageToBlob(`data:image/jpeg;base64,${b64}`);
    expect(fromUrl?.type).toBe("image/jpeg");
    expect(new Uint8Array((await fromUrl?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(jpeg);
    expect(imageToBlob(b64)?.size).toBe(4);
    expect(imageToBlob("data:image/png,not-base64")).toBeUndefined();
    expect(imageToBlob("!!!not base64!!!")).toBeUndefined();
  });
});
