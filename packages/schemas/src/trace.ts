import { newId, TraceId } from "./ids";

/** One trace ID per run, carried on every hop (AGENTS.md §7, SECURITY_PRIVACY §6). */
export const TRACE_HEADER = "x-mira-trace";
/** Pub/Sub attribute carrying the same ID. */
export const TRACE_ATTRIBUTE = "miraTrace";

/** Returns the incoming trace ID if it is well formed, otherwise a fresh one. */
export function traceIdFrom(incoming: string | null | undefined): string {
  return incoming !== null && incoming !== undefined && TraceId.safeParse(incoming).success
    ? incoming
    : newId("trc");
}
