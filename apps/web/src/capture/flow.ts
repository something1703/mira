import { TwinGroupName } from "@mira/schemas";

/**
 * The capture sequence (docs/UX_FLOWS.md §3): face, two repeats, full body, hand, hair angles.
 * Pure state and rules, so which steps appear, when a step is done and what is sent to the build
 * are all testable without a browser or a camera.
 */
export type StepId = "face" | "repeats" | "body" | "hand" | "hair";
export type HairAngle = "front" | "right" | "left";

export interface Photo {
  /** Where the server holds it (`uploads/{userId}/...`). Never shown to the person. */
  key: string;
  width: number;
  height: number;
  /** The short side is long enough for HD skin analysis. */
  hdCapable: boolean;
  source: "camera" | "upload";
}

export interface Plan {
  steps: readonly StepId[];
  /** A retry of some groups only; the rest of the profile is kept. */
  only?: readonly TwinGroupName[];
}

export const OPTIONAL: ReadonlySet<StepId> = new Set(["repeats", "body", "hand", "hair"]);

const GROUPS = new Set<string>(TwinGroupName.options);

/**
 * From the page's query: `?only=face,hair` retries those groups; `?step=repeats` re-takes the
 * skin group with its repeat captures (the repeats must come from the same session as the first
 * photo, so the first photo is taken again too).
 */
export function planFrom(query: { only?: string | undefined; step?: string | undefined }): Plan {
  const asked = (query.step === "repeats" ? "skin" : (query.only ?? ""))
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is TwinGroupName => GROUPS.has(s));
  const only = [...new Set(asked)];
  if (only.length === 0) return { steps: ["face", "repeats", "body", "hand", "hair"] };
  const steps: StepId[] = [];
  if (only.some((g) => g === "skin" || g === "colouring" || g === "face")) steps.push("face");
  if (only.includes("skin")) steps.push("repeats");
  if (only.includes("hair")) steps.push("hair");
  return { steps, only };
}

export interface FlowState {
  plan: Plan;
  /** Index into `plan.steps`; equal to its length once every step is done or skipped. */
  index: number;
  face?: Photo;
  repeats: Photo[];
  body?: Photo;
  hand?: Photo;
  hair: Partial<Record<HairAngle, Photo>>;
  skipped: StepId[];
}

export const initialState = (plan: Plan): FlowState => ({
  plan,
  index: 0,
  repeats: [],
  hair: {},
  skipped: [],
});

export type Action =
  | { t: "face"; photo: Photo }
  | { t: "repeat"; photo: Photo }
  | { t: "body"; photo: Photo }
  | { t: "hand"; photo: Photo }
  | { t: "hair"; photos: Partial<Record<HairAngle, Photo>> }
  | { t: "skip" }
  | { t: "back" }
  | { t: "retake"; step: StepId };

export const stepOf = (s: FlowState): StepId | undefined => s.plan.steps[s.index];
export const isDone = (s: FlowState) => s.index >= s.plan.steps.length;

/** Whether a step has what it needs. A skipped optional step counts as done. */
export function stepComplete(s: FlowState, step: StepId): boolean {
  if (s.skipped.includes(step)) return OPTIONAL.has(step);
  switch (step) {
    case "face":
      return s.face !== undefined;
    case "repeats":
      return s.repeats.length >= 2;
    case "body":
      return s.body !== undefined;
    case "hand":
      return s.hand !== undefined;
    case "hair":
      return s.hair.front !== undefined;
  }
}

function advance(s: FlowState): FlowState {
  let index = s.index;
  while (index < s.plan.steps.length && stepComplete(s, s.plan.steps[index] as StepId)) index += 1;
  return { ...s, index };
}

export function reduce(s: FlowState, a: Action): FlowState {
  switch (a.t) {
    case "face":
      // A new first photo makes earlier repeats a different session.
      return advance({ ...s, face: a.photo, repeats: [] });
    case "repeat":
      return advance({ ...s, repeats: [...s.repeats, a.photo].slice(0, 2) });
    case "body":
      return advance({ ...s, body: a.photo });
    case "hand":
      return advance({ ...s, hand: a.photo });
    case "hair":
      return advance({ ...s, hair: a.photos });
    case "skip": {
      const step = stepOf(s);
      if (step === undefined || !OPTIONAL.has(step)) return s;
      return advance({ ...s, skipped: [...s.skipped, step] });
    }
    case "back":
      return { ...s, index: Math.max(0, s.index - 1) };
    case "retake": {
      const at = s.plan.steps.indexOf(a.step);
      if (at < 0) return s;
      const cleared: FlowState = {
        ...s,
        index: at,
        skipped: s.skipped.filter((x) => x !== a.step),
      };
      switch (a.step) {
        case "face":
          return { ...cleared, repeats: [] };
        case "repeats":
          return { ...cleared, repeats: [] };
        case "body": {
          const { body: _body, ...rest } = cleared;
          return rest;
        }
        case "hand": {
          const { hand: _hand, ...rest } = cleared;
          return rest;
        }
        case "hair":
          return { ...cleared, hair: {} };
      }
    }
  }
}

/** Every photo the person has accepted, to show what is held and to delete on cancel. */
export function heldKeys(s: FlowState): string[] {
  return [
    s.face?.key,
    ...s.repeats.map((p) => p.key),
    s.body?.key,
    s.hand?.key,
    s.hair.front?.key,
    s.hair.right?.key,
    s.hair.left?.key,
  ].filter((k): k is string => k !== undefined);
}

/** What the build reads: the photos of the face and hair steps, never the body or hand. */
export interface BuildCapture {
  face: string;
  repeats?: string[];
  hair?: { front: string; right?: string; left?: string };
  mode: "hd" | "sd";
  source: "camera" | "upload";
  qualityChecksPassed: boolean | null;
  only?: TwinGroupName[];
}

/**
 * The request for the quote and the build, or undefined if the face (or, for a hair-only retry,
 * the hair) is missing. HD only when every face photo is sharp enough: one standard-detail photo
 * means the whole profile is measured in standard detail, and the screen says so.
 */
export function toCapture(s: FlowState): BuildCapture | undefined {
  const hairOnly = s.plan.only?.length === 1 && s.plan.only[0] === "hair";
  const facePhotos = [...(s.face ? [s.face] : []), ...s.repeats];
  const face = s.face ?? (hairOnly ? s.hair.front : undefined);
  if (face === undefined) return undefined;
  const cameraOnly = [...facePhotos, ...Object.values(s.hair)].every((p) => p.source === "camera");
  const { front, right, left } = s.hair;
  return {
    face: face.key,
    ...(s.repeats.length > 0 ? { repeats: s.repeats.map((p) => p.key) } : {}),
    ...(front
      ? {
          hair: {
            front: front.key,
            ...(right ? { right: right.key } : {}),
            ...(left ? { left: left.key } : {}),
          },
        }
      : {}),
    mode: facePhotos.length > 0 && facePhotos.every((p) => p.hdCapable) ? "hd" : "sd",
    source: cameraOnly ? "camera" : "upload",
    qualityChecksPassed: cameraOnly ? true : null,
    ...(s.plan.only ? { only: [...s.plan.only] } : {}),
  };
}

/** Whether the profile will be measured in standard detail because a photo is below HD size. */
export function downgraded(s: FlowState): boolean {
  const photos = [...(s.face ? [s.face] : []), ...s.repeats];
  return photos.length > 0 && photos.some((p) => !p.hdCapable);
}
