import { z } from "zod";
import { canonicalJson, sha256 } from "./canonical";

/**
 * Recorded YouCam responses (docs/TESTING.md, Mock mode). A fixture is one real task: the request
 * it answers (minus file references), how long it took, what it returned and what it cost. Signed
 * URLs are replaced with local file references and input faces are never stored (AGENTS.md §11).
 */

const FILE_KEYS = new Set([
  "src_file_id",
  "src_file_url",
  "src_file_ids",
  "src_file_urls",
  "ref_file_id",
  "ref_file_url",
  "ref_file_ids",
  "ref_file_urls",
]);

/** The part of a request that decides the answer: everything except which files were sent. */
export function bodyKey(slug: string, body: Record<string, unknown>): string {
  const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !FILE_KEYS.has(k)));
  return sha256(canonicalJson([slug, rest]));
}

const SIGNED = /[?&](X-Amz-[A-Za-z-]+|Signature|Expires|token|sig|GoogleAccessId)=/i;

/** Replaces any signed URL with `fixture://<hash><ext>` and returns what it replaced. */
export function scrubUrls(value: unknown): { value: unknown; replaced: Record<string, string> } {
  const replaced: Record<string, string> = {};
  const walk = (v: unknown): unknown => {
    if (typeof v === "string" && /^https?:\/\//.test(v) && SIGNED.test(v)) {
      const path = v.split("?")[0] ?? v;
      const ext = /\.[A-Za-z0-9]{2,5}$/.exec(path)?.[0] ?? "";
      const ref = `fixture://${sha256(path).slice(0, 16)}${ext}`;
      replaced[ref] = v;
      return ref;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]),
      );
    }
    return v;
  };
  return { value: walk(value), replaced };
}

export const Fixture = z.object({
  feature: z.string(),
  version: z.string(),
  name: z.string().min(1),
  recordedAt: z.iso.datetime(),
  /** `bodyKey(feature, request body)` of the recorded request. */
  key: z.string(),
  /** Real time the task took, in ms. Replay scales it down (CONFIG.mock.latencyScale). */
  latencyMs: z.number().nonnegative(),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("success"), results: z.unknown() }),
    z.object({ status: z.literal("error"), error: z.string(), message: z.string().optional() }),
  ]),
  /** Units YouCam charged (0 for an error), as read from the feature-cost-priced run. */
  unitsCharged: z.number().nonnegative(),
});
export type Fixture = z.infer<typeof Fixture>;

export const COST_SNAPSHOT_FILE = "feature-cost.json";
