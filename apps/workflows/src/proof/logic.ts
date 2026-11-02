import {
  CONFIG,
  err,
  ok,
  type NoiseFloorEntry,
  type ProofRecord,
  type ProofSession,
  type Result,
  type Verdict,
} from "@mira/schemas";
import type { EngineClient, EngineFailure } from "../twin/engine-client";

/**
 * The maths of a proof lives in the engines (docs/ENGINES.md §8). This module only decides what to
 * ask them and what the answer means for the person: when the baseline is complete, how the
 * variation is learned, and which state a check-in lands in.
 */
const BASELINE = () => CONFIG.proof.baselineSessions.value;

export const baselineSessions = (p: Pick<ProofRecord, "sessions">): ProofSession[] =>
  p.sessions.filter((s) => s.kind === "baseline");

export const baselineComplete = (p: Pick<ProofRecord, "sessions">): boolean =>
  baselineSessions(p).length >= BASELINE();

/** The mean of the first baseline sessions' means: what a check-in is compared with. */
export function baselineMean(p: Pick<ProofRecord, "sessions">): number | undefined {
  const first = baselineSessions(p).slice(0, BASELINE());
  if (first.length < BASELINE()) return undefined;
  return first.reduce((n, s) => n + s.mean, 0) / first.length;
}

/** Whole days between two instants. */
export const daysBetween = (from: string, to: string): number =>
  Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000));

/** When the next check-in is due, once tracking has begun. */
export function nextDue(p: ProofRecord): string | undefined {
  if (p.status !== "tracking") return undefined;
  const last = p.sessions.at(-1)?.at ?? p.startedAt;
  if (last === undefined) return undefined;
  return new Date(
    Date.parse(last) + CONFIG.proof.checkInEveryDays.value * 86_400_000,
  ).toISOString();
}

/** Learns the day-to-day variation from the baseline sessions' captures. */
export async function learnNoiseFloor(
  engine: EngineClient,
  p: Pick<ProofRecord, "sessions">,
): Promise<Result<NoiseFloorEntry, EngineFailure>> {
  const sessions = baselineSessions(p).map((s) => s.scores);
  if (sessions.length === 0) return err({ code: "engine_bad_reply", retryable: false });
  const r = await engine.noiseFloor(sessions);
  if (!r.ok) return err(r.error);
  const v = r.value.value;
  return ok({
    sessions: v.sessions,
    capturesPerSession: v.captures_per_session,
    sW: v.s_w,
    sD: v.s_d,
    sDSource: v.s_d_source,
    se: v.se,
    mdc: v.mdc,
  });
}

/**
 * A check-in's verdict. The words come from the engine's comparison of the change with the
 * minimal detectable change; this decides which state that puts the proof in. A claim to reduce a
 * visible concern is a claim that `raw_score` goes up (higher is healthier-looking).
 */
export async function judge(
  engine: EngineClient,
  p: ProofRecord,
  session: ProofSession,
  noiseFloor: NoiseFloorEntry | undefined,
): Promise<Result<Verdict, EngineFailure | { code: "no_baseline"; retryable: false }>> {
  const baseline = baselineMean(p);
  if (baseline === undefined || p.startedAt === undefined) {
    return err({ code: "no_baseline", retryable: false });
  }
  const r = await engine.change({
    baseline,
    now: session.mean,
    mdc: noiseFloor?.mdc ?? null,
    claimDirection: "up",
  });
  if (!r.ok) return err(r.error);
  const day = daysBetween(p.startedAt, session.at);
  const windowDays = p.claim.windowDays;
  const words = r.value.value.words;
  const state: Verdict["state"] =
    words === "n/a"
      ? "collecting"
      : words === "opposite"
        ? "opposite"
        : words === "within"
          ? day >= windowDays
            ? "window_ended_no_change"
            : "not_yet"
          : "detected";
  return ok({
    at: session.at,
    day,
    windowDays,
    baseline,
    now: session.mean,
    delta: r.value.value.delta,
    mdc: noiseFloor?.mdc ?? null,
    words,
    phrase: r.value.value.phrase,
    state,
  });
}
