import {
  GarmentColour,
  GarmentItem,
  newId,
  err,
  ok,
  type GarmentCategory,
  type GarmentKind,
} from "@mira/schemas";
import { getDoc, type Ports } from "@mira/runtime";
import { cutoutPng, loadSampleGarments, placeholderPng } from "@mira/fixtures";
import { z } from "zod";
import type { GraphSpec } from "../runner/graph";
import type { NodeExecutor } from "../runner/runner";
import type { EngineClient } from "../twin/engine-client";
import { uploadsPrefix } from "../twin/profile";
import { recordUpload } from "../twin/uploads";

/**
 * Garments (docs/PHASE_08, "garment ingest from a product link"): a picture of a garment goes
 * through YouCam's background removal, the engines read its colour (docs/ENGINES.md §6), and the
 * result is a garment MIRA can try on. The picture is kept like a held photo and deleted with the
 * others (D39); the garment's record holds a name and numbers.
 */
export const garmentPath = (userId: string, id: string) => `garments/${userId}/${id}`;

export const GARMENT_EXECUTOR = "garment-save";

const BODY = z.object({
  userId: z.string(),
  name: z.string().min(1).max(120),
  kind: z.enum(["outfit", "shoes", "bag"]),
  category: z.enum(["upper_body", "lower_body", "full_body", "outer", "auto", "shoes"]),
  source: GarmentItem.shape.source,
  /** Mock mode: the colour is invented and the record says so. */
  sample: z.boolean(),
});

/** Background removal, then the colour. Two steps, one of them a priced YouCam call. */
export function buildGarmentIngestGraph(input: {
  photo: string;
  userId: string;
  name: string;
  kind: GarmentKind;
  category: GarmentCategory;
  source: GarmentItem["source"];
  sample: boolean;
}): GraphSpec {
  return {
    type: "catalogue_ingest",
    nodes: [
      {
        id: "cutout",
        kind: "youcam",
        label: "step.remove_background",
        feature: "sod",
        inputs: { src: `blob:${input.photo}` },
      },
      {
        id: "garment",
        kind: "engine",
        label: "step.read_garment_colour",
        feature: GARMENT_EXECUTOR,
        dependsOn: ["cutout"],
        params: {
          userId: input.userId,
          name: input.name,
          kind: input.kind,
          category: input.category,
          source: input.source,
          sample: input.sample,
        },
      },
    ],
  };
}

/** Lab → sRGB (D65), for showing the colour on screen. The engines do the measuring. */
export function labToHex(lab: readonly [number, number, number]): string {
  const [l, a, b] = lab;
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const xyz = [0.95047 * f(fx), f(fy), 1.08883 * f(fz)] as const;
  const lin = [
    3.2406 * xyz[0] - 1.5372 * xyz[1] - 0.4986 * xyz[2],
    -0.9689 * xyz[0] + 1.8758 * xyz[1] + 0.0415 * xyz[2],
    0.0557 * xyz[0] - 0.204 * xyz[1] + 1.057 * xyz[2],
  ];
  const enc = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
  };
  return `#${lin.map((c) => enc(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const garmentId = () => `gar_${newId("lk").slice(3, 19)}`;

export function createGarmentExecutors(deps: {
  engine: EngineClient;
  ports: Pick<Ports, "state" | "blobs" | "clock">;
}): Record<string, NodeExecutor> {
  const save: NodeExecutor = async (ctx) => {
    const params = BODY.safeParse(ctx.node.params);
    if (!params.success) return err({ code: "bad_params", retryable: false });
    const cut = ctx.upstream["cutout"];
    const blob = cut?.resultRef ? await deps.ports.blobs.get(cut.resultRef) : undefined;
    if (!blob) return err({ code: "cutout_missing", retryable: false });
    const read = await deps.engine.garmentColour(Buffer.from(blob.bytes).toString("base64"));
    if (!read.ok) return err(read.error);
    const g = read.value.value;
    const id = garmentId();
    const key = `${uploadsPrefix(params.data.userId)}${newId("up")}.png`;
    await deps.ports.blobs.put(key, blob.bytes, "image/png");
    await recordUpload(deps.ports, {
      key,
      kind: "garment",
      at: new Date(deps.ports.clock.now()).toISOString(),
    });
    const item = GarmentItem.parse({
      id,
      name: params.data.name,
      kind: params.data.kind,
      category: params.data.category,
      image: key,
      colour: GarmentColour.parse({
        lab: g.lab,
        hex: labToHex(g.lab),
        auditLabs: g.audit_labs,
        multicolour: g.multicolour,
        share: g.share,
      }),
      source: params.data.source,
      sample: params.data.sample,
    });
    await deps.ports.state.set(garmentPath(params.data.userId, id), item);
    return ok({ output: item });
  };
  return { [GARMENT_EXECUTOR]: save };
}

export async function loadGarment(
  ports: Pick<Ports, "state">,
  userId: string,
  id: string,
): Promise<GarmentItem | undefined> {
  return await getDoc(ports.state, garmentPath(userId, id), GarmentItem);
}

/**
 * Mock mode: a sample garment, made when it is picked. The picture is a plain shape in the
 * sample's colour, not a product photo, and the record says it is a sample.
 */
export async function makeSampleGarment(
  ports: Pick<Ports, "state" | "blobs" | "clock">,
  engine: EngineClient,
  userId: string,
  sampleId: string,
): Promise<GarmentItem | undefined> {
  const sample = loadSampleGarments().find((g) => g.id === sampleId);
  if (!sample) return undefined;
  const read = await engine.garmentColour(
    Buffer.from(cutoutPng({ hex: sample.hex })).toString("base64"),
  );
  if (!read.ok) return undefined;
  const key = `${uploadsPrefix(userId)}${newId("up")}.png`;
  // The reference picture YouCam receives: in mock mode, a plain picture in the sample's colour.
  await ports.blobs.put(key, placeholderPng({ hex: sample.hex }), "image/png");
  await recordUpload(ports, {
    key,
    kind: "garment",
    at: new Date(ports.clock.now()).toISOString(),
  });
  const g = read.value.value;
  const item = GarmentItem.parse({
    id: garmentId(),
    name: sample.name,
    kind: sample.kind,
    category: sample.category,
    image: key,
    colour: GarmentColour.parse({
      lab: g.lab,
      hex: labToHex(g.lab),
      auditLabs: g.audit_labs,
      multicolour: g.multicolour,
      share: g.share,
    }),
    source: { kind: "sample" },
    sample: true,
  });
  await ports.state.set(garmentPath(userId, item.id), item);
  return item;
}
