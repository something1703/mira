import { z } from "zod";

/** Prefixed random IDs, readable in logs and the run viewer: `run_3f9c…`. */
export const ID_PREFIXES = [
  "run",
  "node",
  "plan",
  "led",
  "rnd",
  "usr",
  "ses",
  "trc",
  "prf",
  "lk",
  "del",
  "up",
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

export const idOf = (prefix: IdPrefix) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{6,64}$`), `Expected a ${prefix}_ ID`);

export const RunId = idOf("run");
export const NodeId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, "Expected a node key");
export const PlanId = idOf("plan");
export const LedgerEntryId = idOf("led");
export const RenderId = idOf("rnd");
export const UserId = idOf("usr");
export const SessionId = idOf("ses");
export const TraceId = idOf("trc");
