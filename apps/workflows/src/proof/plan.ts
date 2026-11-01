import { CONFIG, err, newId, ok, type ProofRecord, type Quote, type Result } from "@mira/schemas";
import type { Ports } from "@mira/runtime";
import type { Engine } from "../engine";
import { buildSessionGraph, buildVisualGraph, minGapMs } from "../graphs/proof-check-in";
import { buildPhantomGraph } from "../graphs/proof-setup";
import { sha256 } from "../lifecycle/canonical";
import { buildQuote, type QuoteError } from "../quote";
import type { GraphSpec } from "../runner/graph";
import type { EngineClient } from "../twin/engine-client";
import { uploadsPrefix } from "../twin/profile";
import { baselineComplete } from "./logic";
import { loadProof } from "./store";

export type ProofError =
  | { code: "proof_not_found" }
  | { code: "wrong_state"; status: ProofRecord["status"] }
  | { code: "too_soon"; nextAt: string }
  | { code: "wrong_photo_count"; wanted: number }
  | { code: "upload_foreign"; key: string }
  | { code: "upload_missing"; key: string }
  | { code: "photos_duplicate"; key: string }
  | { code: "variation_unknown" }
  | { code: "already_calibrated" }
  | { code: "phantom_unusable" }
  | { code: "no_change_to_show" }
  | { code: "outside_range" }
  | { code: "engine_failed"; detail: string }
  | { code: "quote_failed"; detail: QuoteError }
  | { code: "over_cap"; quote: Quote }
  | { code: "quote_changed"; quote: Quote }
  | { code: "graph_rejected" };

export type ProofPlanned = { quote: Quote; runId?: string | undefined; intensity?: number };

interface Common {
  userId: string;
  sessionId: string;
  proofId: string;
  confirmedTotal?: number | undefined;
}

async function checkPhotos(
  ports: Ports,
  userId: string,
  keys: readonly string[],
): Promise<ProofError | undefined> {
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(uploadsPrefix(userId))) return { code: "upload_foreign", key };
    const blob = await ports.blobs.get(key);
    if (!blob) return { code: "upload_missing", key };
    // The same picture twice has no spread to measure: the saved-result cache would answer both
    // with one result, and the variation would be learned from nothing (the Phase 5 rule).
    const hash = sha256(blob.bytes);
    if (seen.has(hash)) return { code: "photos_duplicate", key };
    seen.add(hash);
  }
  return undefined;
}

async function quoteAndStart(
  engine: Engine,
  ports: Ports,
  graph: GraphSpec,
  c: Common,
  start: boolean,
): Promise<Result<ProofPlanned, ProofError>> {
  const quote = await buildQuote({
    graph,
    sessionId: c.sessionId,
    costs: engine.costs,
    ledger: engine.ledger,
    isCached: (node) => engine.runner.lifecycle.wouldHit(node),
    now: () => ports.clock.now(),
  });
  if (!quote.ok) return err({ code: "quote_failed", detail: quote.error });
  if (!start) return ok({ quote: quote.value });
  if (quote.value.overCap) return err({ code: "over_cap", quote: quote.value });
  if (c.confirmedTotal !== undefined && quote.value.total > c.confirmedTotal) {
    return err({ code: "quote_changed", quote: quote.value });
  }
  const started = await engine.runner.startRun({
    graph,
    userId: c.userId,
    sessionId: c.sessionId,
    planId: newId("plan"),
    quote: quote.value,
    removed: [],
    recorded: false,
  });
  if (!started.ok) return err({ code: "graph_rejected" });
  return ok({ quote: quote.value, runId: started.value.id });
}

/** A session of captures: part of the baseline, or a check-in. */
export async function planSession(
  engine: Engine,
  ports: Ports,
  req: Common & {
    kind: "baseline" | "check_in";
    photos: readonly string[];
    confound?: boolean | undefined;
  },
  start: boolean,
): Promise<Result<ProofPlanned, ProofError>> {
  const proof = await loadProof(ports, req.userId, req.proofId);
  if (!proof) return err({ code: "proof_not_found" });
  const expected = req.kind === "baseline" ? "baseline" : "tracking";
  if (proof.status !== expected) return err({ code: "wrong_state", status: proof.status });
  if (req.kind === "baseline" && baselineComplete(proof)) {
    return err({ code: "wrong_state", status: "ready" });
  }
  // Two sessions on one day are one day to the person, and would teach MIRA nothing about
  // day-to-day variation.
  const last = proof.sessions.at(-1);
  if (last && ports.clock.now() < Date.parse(last.at) + minGapMs()) {
    return err({
      code: "too_soon",
      nextAt: new Date(Date.parse(last.at) + minGapMs()).toISOString(),
    });
  }
  const wanted = CONFIG.proof.capturesPerSession.value;
  if (req.photos.length !== wanted) return err({ code: "wrong_photo_count", wanted });
  const bad = await checkPhotos(ports, req.userId, req.photos);
  if (bad) return err(bad);
  const graph = buildSessionGraph({
    userId: req.userId,
    proofId: req.proofId,
    concern: proof.claim.concern,
    kind: req.kind,
    photos: req.photos,
    confound: req.confound === true,
  });
  return await quoteAndStart(engine, ports, graph, req, start);
}

/** The calibration phantom: one photo, five simulations, five measurements. */
export async function planPhantom(
  engine: Engine,
  ports: Ports,
  req: Common & { photo: string },
  start: boolean,
): Promise<Result<ProofPlanned, ProofError>> {
  const proof = await loadProof(ports, req.userId, req.proofId);
  if (!proof) return err({ code: "proof_not_found" });
  if (proof.status !== "ready" && proof.status !== "tracking") {
    return err({ code: "wrong_state", status: proof.status });
  }
  if (!proof.noiseFloor?.mdc) return err({ code: "variation_unknown" });
  if (proof.phantom) return err({ code: "already_calibrated" });
  const bad = await checkPhotos(ports, req.userId, [req.photo]);
  if (bad) return err(bad);
  const graph = buildPhantomGraph({
    userId: req.userId,
    proofId: req.proofId,
    concern: proof.claim.concern,
    photo: req.photo,
  });
  return await quoteAndStart(engine, ports, graph, req, start);
}

/**
 * A visualisation of a measured change, or of the smallest change MIRA can detect. Skin Simulation
 * can only make a concern more visible, so an improvement is shown as the earlier, more visible
 * state of today's photo, and the screen says so.
 */
export async function planVisual(
  engine: Engine,
  ports: Ports,
  engines: EngineClient,
  req: Common & { photo: string; target: "verdict" | "preview" },
  start: boolean,
): Promise<Result<ProofPlanned, ProofError>> {
  const proof = await loadProof(ports, req.userId, req.proofId);
  if (!proof) return err({ code: "proof_not_found" });
  const phantom = proof.phantom;
  if (!phantom?.usable) return err({ code: "phantom_unusable" });
  const verdict = proof.verdicts.at(-1);
  const size =
    req.target === "preview"
      ? phantom.mdc
      : verdict &&
          (verdict.state === "detected" || verdict.state === "opposite") &&
          verdict.delta > 0
        ? verdict.delta
        : undefined;
  if (size === undefined) return err({ code: "no_change_to_show" });
  const fit = await engines.phantomFit({
    intensities: phantom.intensities,
    scores: phantom.scores,
    mdc: phantom.mdc,
    invertAt: -size,
  });
  if (!fit.ok) return err({ code: "engine_failed", detail: fit.error.code });
  const intensity = fit.value.value.inverted_intensity;
  // Outside what the sweep covered, MIRA shows numbers only rather than extrapolating.
  if (intensity === null || intensity === undefined) return err({ code: "outside_range" });
  const bad = await checkPhotos(ports, req.userId, [req.photo]);
  if (bad) return err(bad);
  const graph = buildVisualGraph({ photo: req.photo, concern: proof.claim.concern, intensity });
  const planned = await quoteAndStart(engine, ports, graph, req, start);
  return planned.ok ? ok({ ...planned.value, intensity }) : planned;
}
