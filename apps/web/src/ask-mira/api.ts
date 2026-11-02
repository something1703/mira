import { AskResponse, type AskContext, type ChatMessage } from "@mira/schemas";
import { z } from "zod";
import { RunView } from "../runs/api";

/** The panel's calls. Each parses what comes back; a reply that does not match is not shown. */
export type Reply<T> = { ok: true; value: T } | { ok: false; code: "unavailable" | "aborted" };

async function post<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<Reply<T> & { status?: number }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    const json: unknown = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, value: parsed.data, status: res.status }
      : { ok: false, code: "unavailable", status: res.status };
  } catch (e) {
    return {
      ok: false,
      code: e instanceof DOMException && e.name === "AbortError" ? "aborted" : "unavailable",
    };
  }
}

export const ask = (
  messages: readonly ChatMessage[],
  context: Omit<AskContext, "heldPhoto">,
  signal?: AbortSignal,
) => post("/api/ask", { messages, context }, AskResponse, signal);

export const narrate = (runId: string) => post("/api/ask/narrate", { runId }, AskResponse);

const Started = z.object({ status: z.literal("started"), runId: z.string() });
const Refused = z.object({ status: z.literal("refused"), reason: z.string() });
export const confirmPlan = (planId: string) =>
  post("/api/ask/confirm", { planId }, z.union([Started, Refused]));

export async function fetchRun(runId: string): Promise<RunView | undefined> {
  try {
    const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (!res.ok) return undefined;
    const parsed = RunView.safeParse(await res.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
