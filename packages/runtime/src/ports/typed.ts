import type { z } from "zod";
import type { StateStore } from "./state";

/** Reads a document and validates it with a Zod schema, so a bad stored shape fails loudly. */
export async function getDoc<S extends z.ZodType>(
  store: StateStore,
  path: string,
  schema: S,
): Promise<z.infer<S> | undefined> {
  const raw = await store.get(path);
  return raw === undefined ? undefined : schema.parse(raw);
}

/** Validated read-modify-write: the current value and the result are both parsed. */
export async function updateDoc<S extends z.ZodType>(
  store: StateStore,
  path: string,
  schema: S,
  fn: (current: z.infer<S> | undefined) => z.infer<S>,
): Promise<z.infer<S>> {
  const next = await store.update(path, (raw) =>
    schema.parse(fn(raw === undefined ? undefined : schema.parse(raw))),
  );
  return schema.parse(next);
}

export async function listDocs<S extends z.ZodType>(
  store: StateStore,
  collection: string,
  schema: S,
): Promise<{ id: string; value: z.infer<S> }[]> {
  const docs = await store.list(collection);
  return docs.map((d) => ({ id: d.id, value: schema.parse(d.value) }));
}
