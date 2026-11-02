import { describe, expect, it } from "vitest";
import {
  downgraded,
  heldKeys,
  initialState,
  isDone,
  planFrom,
  reduce,
  stepOf,
  toCapture,
  type Action,
  type FlowState,
  type Photo,
} from "./flow";

const photo = (key: string, o: Partial<Photo> = {}): Photo => ({
  key: `uploads/usr_a/${key}.jpg`,
  width: 1200,
  height: 1600,
  hdCapable: true,
  source: "camera",
  ...o,
});
const run = (s: FlowState, ...actions: Action[]) => actions.reduce(reduce, s);
const full = () => initialState(planFrom({ step: "all" }));

describe("planFrom", () => {
  it("is one face photo by default, and the whole sequence on ?step=all", () => {
    expect(planFrom({})).toEqual({ steps: ["face"] });
    expect(planFrom({ step: "all" }).steps).toEqual(["face", "repeats", "body", "hand", "hair"]);
    expect(planFrom({ step: "all" }).only).toBeUndefined();
  });

  it("retries only the groups asked for, and ignores anything else", () => {
    expect(planFrom({ only: "hair" })).toEqual({ steps: ["hair"], only: ["hair"] });
    expect(planFrom({ only: "face,colouring" })).toEqual({
      steps: ["face"],
      only: ["face", "colouring"],
    });
    expect(planFrom({ only: "skin" }).steps).toEqual(["face", "repeats"]);
    expect(planFrom({ only: "nonsense,<script>" }).steps).toEqual(["face"]);
  });

  it("?step=repeats re-takes the skin group with its repeats", () => {
    expect(planFrom({ step: "repeats" })).toEqual({ steps: ["face", "repeats"], only: ["skin"] });
  });
});

describe("the sequence", () => {
  it("moves on as each step gets its photo", () => {
    let s = full();
    expect(stepOf(s)).toBe("face");
    s = run(s, { t: "face", photo: photo("f") });
    expect(stepOf(s)).toBe("repeats");
    s = run(s, { t: "repeat", photo: photo("r1") });
    expect(stepOf(s)).toBe("repeats");
    s = run(s, { t: "repeat", photo: photo("r2") });
    expect(stepOf(s)).toBe("body");
  });

  it("an optional step can be skipped; the face cannot", () => {
    let s = run(full(), { t: "skip" });
    expect(stepOf(s)).toBe("face");
    s = run(s, { t: "face", photo: photo("f") }, { t: "skip" });
    expect(s.skipped).toEqual(["repeats"]);
    expect(stepOf(s)).toBe("body");
    s = run(s, { t: "skip" }, { t: "skip" }, { t: "skip" });
    expect(isDone(s)).toBe(true);
  });

  it("hair is complete with the front photo alone", () => {
    const s = run(initialState(planFrom({ only: "hair" })), {
      t: "hair",
      photos: { front: photo("h") },
    });
    expect(isDone(s)).toBe(true);
  });

  it("a new first photo discards repeats taken against the old one", () => {
    let s = run(full(), { t: "face", photo: photo("f") }, { t: "repeat", photo: photo("r1") });
    s = run(s, { t: "retake", step: "face" }, { t: "face", photo: photo("f2") });
    expect(s.repeats).toEqual([]);
    expect(stepOf(s)).toBe("repeats");
  });

  it("back moves one step and retake clears the step", () => {
    let s = run(
      full(),
      { t: "face", photo: photo("f") },
      { t: "skip" },
      { t: "body", photo: photo("b") },
    );
    expect(stepOf(s)).toBe("hand");
    s = run(s, { t: "retake", step: "body" });
    expect(stepOf(s)).toBe("body");
    expect(s.body).toBeUndefined();
    expect(run(s, { t: "back" }).index).toBe(s.index - 1);
    expect(run(full(), { t: "back" }).index).toBe(0);
  });

  it("lists every held photo", () => {
    const s = run(
      full(),
      { t: "face", photo: photo("f") },
      { t: "repeat", photo: photo("r1") },
      { t: "body", photo: photo("b") },
      { t: "hair", photos: { front: photo("hf"), left: photo("hl") } },
    );
    expect(heldKeys(s).map((k) => k.split("/")[2])).toEqual([
      "f.jpg",
      "r1.jpg",
      "b.jpg",
      "hf.jpg",
      "hl.jpg",
    ]);
  });
});

describe("toCapture", () => {
  it("is nothing without a face", () => {
    expect(toCapture(full())).toBeUndefined();
  });

  it("camera photos that are all sharp: HD, camera, checks passed", () => {
    const s = run(
      full(),
      { t: "face", photo: photo("f") },
      { t: "repeat", photo: photo("r1") },
      { t: "repeat", photo: photo("r2") },
    );
    expect(toCapture(s)).toEqual({
      face: "uploads/usr_a/f.jpg",
      repeats: ["uploads/usr_a/r1.jpg", "uploads/usr_a/r2.jpg"],
      mode: "hd",
      source: "camera",
      qualityChecksPassed: true,
    });
  });

  it("one standard-detail photo makes the whole profile standard detail, and says so", () => {
    const s = run(
      full(),
      { t: "face", photo: photo("f") },
      { t: "repeat", photo: photo("r1", { hdCapable: false }) },
    );
    expect(toCapture(s)?.mode).toBe("sd");
    expect(downgraded(s)).toBe(true);
    expect(downgraded(run(full(), { t: "face", photo: photo("f") }))).toBe(false);
  });

  it("an uploaded photo has no camera checks to report", () => {
    const s = run(full(), { t: "face", photo: photo("f", { source: "upload" }) });
    expect(toCapture(s)).toMatchObject({ source: "upload", qualityChecksPassed: null });
  });

  it("never sends the body or hand photo to the build", () => {
    const s = run(
      full(),
      { t: "face", photo: photo("f") },
      { t: "skip" },
      { t: "body", photo: photo("b") },
      { t: "hand", photo: photo("h") },
    );
    expect(JSON.stringify(toCapture(s))).not.toMatch(/\/b\.jpg|\/h\.jpg/);
  });

  it("hair: the front alone, or all three angles", () => {
    const front = run(
      full(),
      { t: "face", photo: photo("f") },
      { t: "hair", photos: { front: photo("hf") } },
    );
    expect(toCapture(front)?.hair).toEqual({ front: "uploads/usr_a/hf.jpg" });
    const all = run(
      full(),
      { t: "face", photo: photo("f") },
      { t: "hair", photos: { front: photo("hf"), right: photo("hr"), left: photo("hl") } },
    );
    expect(toCapture(all)?.hair).toEqual({
      front: "uploads/usr_a/hf.jpg",
      right: "uploads/usr_a/hr.jpg",
      left: "uploads/usr_a/hl.jpg",
    });
  });

  it("a hair-only retry builds from the hair photos and names the group", () => {
    const s = run(initialState(planFrom({ only: "hair" })), {
      t: "hair",
      photos: { front: photo("hf") },
    });
    expect(toCapture(s)).toMatchObject({
      face: "uploads/usr_a/hf.jpg",
      hair: { front: "uploads/usr_a/hf.jpg" },
      only: ["hair"],
    });
  });
});
