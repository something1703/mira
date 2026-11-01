import { Twin, type Metric, type TwinGroup } from "@mira/schemas";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

export const WORKFLOWS = `http://localhost:${process.env.E2E_WORKFLOWS_PORT ?? 4120}`;

export interface Who {
  userId: string;
  sessionId: string;
}

/** The anonymous session in the browser's cookie (src/session.ts): `<base64url json>.<mac>`. */
export async function sessionOf(context: BrowserContext, page: Page): Promise<Who> {
  if (!(await context.cookies()).some((c) => c.name === "mira_session")) await page.goto("/");
  const cookie = (await context.cookies()).find((c) => c.name === "mira_session");
  if (!cookie) throw new Error("no session cookie");
  const body = JSON.parse(
    Buffer.from(cookie.value.split(".")[0] ?? "", "base64url").toString(),
  ) as {
    u: string;
    s: string;
  };
  return { userId: body.u, sessionId: body.s };
}

const AT = "2026-11-01T09:00:05.000Z";
const SRC = (feature: string, version = "v2.0") => ({ feature, version, taskRunId: "run_e2eseed" });
const stamp = { measuredAt: AT, confidence: "n/a" as const };

const num = (
  id: string,
  value: number,
  unit: string,
  feature: string,
  version?: string,
): Metric => ({
  ...stamp,
  id,
  kind: "number",
  value,
  unit,
  source: SRC(feature, version),
});

export const SKIN_METRICS: Metric[] = [
  num("skin.hd_pore.whole", 41.5, "raw score", "skin-analysis", "v2.1"),
  num("skin.hd_redness.whole", 33, "raw score", "skin-analysis", "v2.1"),
  num("skin.hd_dark_circle.left_eye", 28.25, "raw score", "skin-analysis", "v2.1"),
];
export const COLOUR_METRICS: Metric[] = [
  {
    ...stamp,
    id: "colour.skin",
    kind: "colour",
    lab: [64.1, 14.2, 24.9],
    hex: "#C79A78",
    source: SRC("skin-tone-analysis"),
  },
  {
    ...stamp,
    id: "colour.lip",
    kind: "colour",
    lab: [41, 33, 18],
    hex: "#A5504F",
    source: SRC("skin-tone-analysis"),
  },
  num("colour.skin_ita", 41.8, "°", "engine:colour/lab", "0.1.0"),
  {
    ...stamp,
    id: "colour.skin_ita_band",
    kind: "category",
    value: "light",
    source: SRC("engine:colour/lab", "0.1.0"),
  },
  {
    ...stamp,
    id: "colour.fitzpatrick_band",
    kind: "category",
    value: "III",
    source: SRC("fitzpatrick-scale-analyzer"),
  },
];
export const FACE_METRICS: Metric[] = [
  num("face.face_aspect_ratio.1", 1.31, "ratio", "face-attr-analysis"),
  num("face.horizontal_third.1", 0.33, "ratio", "face-attr-analysis"),
  num("face.horizontal_third.2", 0.34, "ratio", "face-attr-analysis"),
];
export const HAIR_METRICS: Metric[] = [
  {
    ...stamp,
    id: "hair.type",
    kind: "category",
    value: "wavy",
    source: SRC("hair-type-detection"),
  },
  {
    ...stamp,
    id: "hair.length",
    kind: "category",
    value: "shoulder",
    source: SRC("hair-length-detection"),
  },
];

const measured: TwinGroup = { status: "measured", missing: [], at: AT };
export interface TwinOptions {
  synthetic?: boolean;
  noiseFloors?: boolean;
  groups?: Partial<Record<"skin" | "colouring" | "face" | "hair", TwinGroup>>;
  metrics?: Metric[];
}

/** A valid profile for the screens' states. Built through the real schema, so a drift fails here. */
export function makeTwin(userId: string, o: TwinOptions = {}): Twin {
  const metrics = o.metrics ?? [
    ...SKIN_METRICS,
    ...COLOUR_METRICS,
    ...FACE_METRICS,
    ...HAIR_METRICS,
  ];
  return Twin.parse({
    userId,
    createdAt: AT,
    updatedAt: AT,
    metrics: Object.fromEntries(metrics.map((m) => [m.id, m])),
    groups: { skin: measured, colouring: measured, face: measured, hair: measured, ...o.groups },
    faceRatios: { horizontal_third: [0.33, 0.34, 0.33] },
    noiseFloors: o.noiseFloors
      ? {
          "skin.hd_pore.whole": {
            sessions: 1,
            capturesPerSession: 3,
            sW: 1.4,
            sD: null,
            sDSource: "unknown",
            se: null,
            mdc: null,
          },
        }
      : {},
    captureMeta: {
      mode: "hd",
      source: "camera",
      repeatsCaptured: o.noiseFloors ? 2 : 0,
      qualityChecksPassed: true,
    },
    runIds: [],
    synthetic: o.synthetic ?? false,
  });
}

export async function seedTwin(request: APIRequestContext, twin: Twin): Promise<void> {
  const res = await request.post(`${WORKFLOWS}/internal/dev/twin`, { data: twin });
  expect(res.status()).toBe(201);
}

export async function setCap(request: APIRequestContext, who: Who, cap: number): Promise<void> {
  const res = await request.post(`${WORKFLOWS}/internal/dev/session-cap`, {
    data: { sessionId: who.sessionId, cap },
  });
  expect(res.ok()).toBe(true);
}

/** A JPEG header with the given size: what the server's checks read. Not a picture of anyone. */
export function jpegBytes(width: number, height: number, salt: number): Buffer {
  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    ...be16(height),
    ...be16(width),
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
    salt & 0xff,
    (salt >> 8) & 0xff,
  ]);
}

let counter = 0;
/** A fresh upload (distinct bytes, so never a saved result) as the signed-in person. */
export async function uploadPhoto(page: Page, name = "face"): Promise<string> {
  counter += 1;
  const res = await page.request.post("/api/uploads?kind=face", {
    headers: { "content-type": "image/jpeg" },
    data: jpegBytes(1200, 1600, (Date.now() % 60000) + counter),
  });
  expect(res.status(), `upload ${name}`).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

/** Quotes and then builds, as the screen does: a build must carry the total the person saw. */
export async function buildFor(
  page: Page,
  face: string,
): Promise<{ status: number; runId?: string; total: number }> {
  const capture = { face, mode: "hd", source: "upload", qualityChecksPassed: null };
  const quote = await page.request.post("/api/twin/quote", { data: { capture } });
  const total = ((await quote.json()) as { quote: { total: number } }).quote.total;
  const build = await page.request.post("/api/twin/build", {
    data: { capture, confirmedTotal: total },
  });
  const body = (await build.json()) as { runId?: string };
  return { status: build.status(), ...(body.runId ? { runId: body.runId } : {}), total };
}
