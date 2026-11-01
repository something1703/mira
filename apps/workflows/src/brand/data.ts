import type { Twin } from "@mira/schemas";
import { LookEventRow, ShadeDemandRow, type Metric } from "@mira/schemas";
import { getDoc, listDocs, type Ports } from "@mira/runtime";
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Anonymised rows for the brand side (docs/DATA_MODEL.md §3). They are written only for a person
 * who said yes (`prefs/{userId}.contribute`), carry no user id, no image and a week instead of a
 * day, and are keyed by a hash so a person's row is replaced, not added to, when they measure
 * again, and can be removed when they say no or delete their profile. The hash is a pseudonym, not
 * anonymity by itself: the rows are what is anonymous, and the cohort rule keeps small groups out.
 */
export const Prefs = z.object({ contribute: z.boolean() });
export type Prefs = z.infer<typeof Prefs>;

type Store = Pick<Ports, "state" | "clock">;

export const prefsPath = (userId: string) => `prefs/${userId}`;
const rowId = (kind: string, key: string) =>
  createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 24);
export const demandPath = (userId: string) => `shade_demand/${rowId("demand", userId)}`;
export const lookEventPath = (runId: string) => `look_events/${rowId("look", runId)}`;

export async function getPrefs(s: Pick<Ports, "state">, userId: string): Promise<Prefs> {
  return (await getDoc(s.state, prefsPath(userId), Prefs)) ?? { contribute: false };
}

/** Turning contribution off removes what was contributed. */
export async function setPrefs(s: Store, userId: string, prefs: Prefs): Promise<void> {
  await s.state.set(prefsPath(userId), prefs);
  if (!prefs.contribute) await s.state.delete(demandPath(userId));
}

/** The ISO week of a date: when, without which day. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${String(t.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
}

const category = (m: Metric | undefined): string | null =>
  m?.kind === "category" ? m.value : null;

/** One row for a person's skin colour, if they agreed. Never throws: a failure here costs a row. */
export async function contributeDemand(s: Store, twin: Twin): Promise<boolean> {
  if (!(await getPrefs(s, twin.userId)).contribute) return false;
  const skin = twin.metrics["colour.skin"];
  if (skin?.kind !== "colour") return false;
  const [L, a, b] = skin.lab;
  const row = ShadeDemandRow.parse({
    skin_L: L,
    skin_a: a,
    skin_b: b,
    h_ab: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
    fitzpatrick_band: category(twin.metrics["colour.fitzpatrick_band"]),
    region: null,
    week: isoWeek(new Date(s.clock.now())),
  });
  await s.state.set(demandPath(twin.userId), row);
  return true;
}

/** One row per built look, for a person who agreed. `saved` is set when the look is kept. */
export async function contributeLook(
  s: Store,
  userId: string,
  runId: string,
  input: { categories: string[]; brandIds: string[]; saved: boolean },
): Promise<boolean> {
  if (!(await getPrefs(s, userId)).contribute) return false;
  const row = LookEventRow.parse({
    categories: input.categories,
    brand_ids: input.brandIds,
    saved: input.saved,
    week: isoWeek(new Date(s.clock.now())),
  });
  await s.state.set(lookEventPath(runId), row);
  return true;
}

export async function markLookSaved(s: Store, userId: string, runId: string): Promise<void> {
  if (!(await getPrefs(s, userId)).contribute) return;
  const path = lookEventPath(runId);
  const current = await getDoc(s.state, path, LookEventRow);
  if (current) await s.state.set(path, { ...current, saved: true });
}

export async function readRows<S extends z.ZodType>(
  s: Pick<Ports, "state">,
  collection: string,
  schema: S,
): Promise<z.infer<S>[]> {
  return (await listDocs(s.state, collection, schema)).map((d) => d.value);
}
