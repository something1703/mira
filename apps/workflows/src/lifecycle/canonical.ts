import { canonicalJson, sha256 } from "@mira/youcam-client";

export { canonicalJson, sha256 };

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
