import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ShadeRange } from "@mira/schemas";
import { COST_SNAPSHOT_FILE, Fixture, type Sku } from "@mira/youcam-client";
import { z } from "zod";

export const RECORDED_DIR = join(import.meta.dirname, "../recorded");

const CostSnapshot = z.array(
  z.object({
    slug: z.string(),
    amount: z.number(),
    description: z.string().optional(),
    unit: z.enum(["result_image", "second"]).optional(),
  }),
);

export interface LoadedFixtures {
  fixtures: Fixture[];
  skus: Sku[];
}

/** Reads every recording under `dir`. An empty folder is a normal, honest answer: nothing recorded. */
export function loadFixtures(dir: string = RECORDED_DIR): LoadedFixtures {
  const fixtures: Fixture[] = [];
  if (existsSync(dir)) {
    for (const feature of readdirSync(dir)) {
      const folder = join(dir, feature);
      if (!statSync(folder).isDirectory()) continue;
      for (const file of readdirSync(folder)) {
        if (file.endsWith(".json"))
          fixtures.push(Fixture.parse(JSON.parse(readFileSync(join(folder, file), "utf8"))));
      }
    }
  }
  const costFile = join(dir, COST_SNAPSHOT_FILE);
  const skus = existsSync(costFile)
    ? CostSnapshot.parse(JSON.parse(readFileSync(costFile, "utf8"))).map((s) => ({
        slug: s.slug,
        amount: s.amount,
        ...(s.description === undefined ? {} : { description: s.description }),
        ...(s.unit === undefined ? {} : { unit: s.unit }),
      }))
    : [];
  return { fixtures, skus };
}

export const hasRecordings = (dir: string = RECORDED_DIR): boolean =>
  loadFixtures(dir).fixtures.length > 0;

/** Where a `fixture://<hash>.<ext>` reference lives on disk. */
export function fixtureFilePath(
  ref: string,
  feature: string,
  dir: string = RECORDED_DIR,
): string | undefined {
  const m = /^fixture:\/\/([0-9a-f]{16}\.[A-Za-z0-9]{2,5})$/.exec(ref);
  return m?.[1] === undefined ? undefined : join(dir, feature, "files", m[1]);
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
};

/**
 * Serves `fixture://` result references from disk, so a replayed run copies its result image the
 * same way a live one downloads it. The feature is found by searching, because the result URL
 * does not carry it.
 */
export function fixtureDownloader(dir: string = RECORDED_DIR) {
  return (
    url: string,
  ): Promise<
    | { ok: true; value: { bytes: Uint8Array; contentType: string } }
    | { ok: false; error: { message: string } }
  > => {
    const name = /^fixture:\/\/([0-9a-f]{16}\.[A-Za-z0-9]{2,5})$/.exec(url)?.[1];
    if (name !== undefined && existsSync(dir)) {
      for (const feature of readdirSync(dir)) {
        const path = join(dir, feature, "files", name);
        if (existsSync(path)) {
          const ext = name.split(".").pop() ?? "";
          return Promise.resolve({
            ok: true as const,
            value: {
              bytes: readFileSync(path),
              contentType: TYPES[ext] ?? "application/octet-stream",
            },
          });
        }
      }
    }
    return Promise.resolve({
      ok: false as const,
      error: { message: `No recorded file for ${url}` },
    });
  };
}

export const CATALOGUES_DIR = join(import.meta.dirname, "../catalogues");

/** Every shade range on disk, checked against the schema, sorted by id. A bad file fails loudly. */
export function loadCatalogues(dir: string = CATALOGUES_DIR): ShadeRange[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ShadeRange.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A saved product page for mock mode, by name (`fixture:<name>` in the shade-range extractor). */
export function loadCataloguePage(name: string, dir: string = CATALOGUES_DIR): string | undefined {
  if (!/^[a-z0-9-]{1,64}$/.test(name)) return undefined;
  const path = join(dir, "pages", `${name}.html`);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}
export * from "./placeholder";
