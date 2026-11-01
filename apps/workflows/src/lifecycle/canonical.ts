import { createHash } from "node:crypto";

/** JSON with sorted keys and no whitespace, so equal values always hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface CacheKeyParts {
  /** Hash of every input (bytes for uploaded images, upstream keys for chained ones). */
  inputHash: string;
  feature: string;
  version: string;
  params: unknown;
  engineVersion: string;
}

/**
 * Cache key = SHA-256(input hash, feature, version, canonical params, engine version)
 * (docs/ARCHITECTURE.md §3, step 1).
 */
export function cacheKey(parts: CacheKeyParts): string {
  return sha256(
    canonicalJson([
      parts.inputHash,
      parts.feature,
      parts.version,
      parts.params,
      parts.engineVersion,
    ]),
  );
}
