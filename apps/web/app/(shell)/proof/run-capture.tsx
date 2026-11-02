"use client";

import type { RunNode } from "@mira/schemas";
import { Banner, Button, ErrorPanel, LabelStrip, Plate, QuoteSheet, StepRail } from "@mira/ui";
import { useEffect, useRef, useState } from "react";
import { discardPhoto } from "../../../src/capture/upload";
import type { Photo } from "../../../src/capture/flow";
import { RunQuoteReply } from "../../../src/proof/api";
import { PROOF_REASONS } from "../../../src/proof/copy";
import { reasonCopy } from "../../../src/profile/copy";
import { RunView } from "../../../src/runs/api";
import { toSteps } from "../../../src/runs/steps";
import { REVIEW_MINUTES } from "../../../src/shade/copy";
import { PhotoStep } from "../capture/photo-step";

const FINISHED = new Set(["succeeded", "failed", "partial", "cancelled"]);

/**
 * Photos, a quote, a run: the one flow behind a session of captures (three photos), the
 * calibration phantom (one) and a visualisation (one). The quote comes first and nothing is
 * rendered until the person confirms; the photos are deleted when the run ends.
 */
export interface RunCaptureProps {
  kind: "session" | "phantom" | "visual";
  /** How many photos to take. */
  photos: number;
  /** Names the photo step, e.g. "Photo for your baseline". */
  label: string;
  title: string;
  confirmLabel: string;
  /** The rest of the request body besides `photos`/`photo` and `proofId`. */
  body: Record<string, unknown>;
  proofId: string;
  /** Show the picture the run makes (a visualisation) with this label. */
  plate?: { node: string; caption: string; alt: string };
  onDone: (outcome: { status: string; runId: string }) => void;
  onCancel: () => void;
}

type Stage =
  | { s: "photos"; taken: Photo[] }
  | { s: "quoting"; taken: Photo[] }
  | { s: "ready"; taken: Photo[]; q: RunQuoteReply }
  | { s: "starting"; taken: Photo[]; q: RunQuoteReply }
  | { s: "running"; runId: string }
  | { s: "finished"; runId: string; view: RunView }
  | { s: "failed"; message: string; taken: Photo[] };

const post = async (path: string, body: unknown) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => undefined)) as unknown };
};

const reasonOf = (json: unknown): string => {
  const code = (json as { error?: unknown } | undefined)?.error;
  return typeof code === "string"
    ? (PROOF_REASONS[code] ?? "That did not work. Nothing was charged.")
    : "That did not work. Nothing was charged.";
};

export function RunCapture(p: RunCaptureProps) {
  const [stage, setStage] = useState<Stage>({ s: "photos", taken: [] });
  const [view, setView] = useState<RunView | undefined>();
  const held = useRef<Photo[]>([]);
  const consumed = useRef(false);

  // Photos held for a run that was never started are deleted when the person leaves.
  useEffect(
    () => () => {
      if (!consumed.current) for (const ph of held.current) void discardPhoto(ph.key);
    },
    [],
  );

  const payload = (taken: Photo[], extra: object = {}) => ({
    proofId: p.proofId,
    ...p.body,
    ...(p.kind === "session" ? { photos: taken.map((t) => t.key) } : { photo: taken[0]?.key }),
    ...extra,
  });

  const quote = async (taken: Photo[]) => {
    setStage({ s: "quoting", taken });
    const res = await post(`/api/proof/run/${p.kind}/quote`, payload(taken));
    const parsed = RunQuoteReply.safeParse(res.json);
    if (res.status !== 200 || !parsed.success) {
      for (const ph of taken) void discardPhoto(ph.key);
      held.current = [];
      setStage({ s: "failed", message: reasonOf(res.json), taken: [] });
      return;
    }
    setStage({ s: "ready", taken, q: parsed.data });
  };

  const start = async (taken: Photo[], q: RunQuoteReply) => {
    setStage({ s: "starting", taken, q });
    const res = await post(
      `/api/proof/run/${p.kind}/start`,
      payload(taken, { confirmedTotal: q.quote.total }),
    );
    const parsed = RunQuoteReply.safeParse(res.json);
    if (res.status !== 201 || !parsed.success || !parsed.data.runId) {
      setStage({ s: "failed", message: reasonOf(res.json), taken });
      return;
    }
    consumed.current = true;
    setStage({ s: "running", runId: parsed.data.runId });
  };

  // The run is polled until it ends.
  const runId = stage.s === "running" ? stage.runId : undefined;
  useEffect(() => {
    if (runId === undefined) return;
    const life = { stopped: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        const parsed = res.ok ? RunView.safeParse(await res.json()) : undefined;
        if (life.stopped) return;
        if (parsed?.success) {
          setView(parsed.data);
          if (FINISHED.has(parsed.data.run.status)) {
            setStage({ s: "finished", runId, view: parsed.data });
            return;
          }
        }
      } catch {
        // Try again on the next tick.
      }
      if (!life.stopped) timer = setTimeout(() => void tick(), 900);
    };
    void tick();
    return () => {
      life.stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  if (stage.s === "photos") {
    const n = stage.taken.length;
    return (
      <div className="proof__capture">
        <h2 className="mira-title">
          {p.photos > 1 ? `Photo ${String(n + 1)} of ${String(p.photos)}` : "Take a photo"}
        </h2>
        <p>Face a window or a lamp, look straight ahead and keep your face still.</p>
        <PhotoStep
          key={n}
          label={p.label}
          engine="camerakit"
          mode="hdskincare"
          kinds={["face"]}
          hd
          onStandardDetail={() => undefined}
          review
          autoStart={n > 0 && stage.taken[n - 1]?.source === "camera"}
          onAccept={(got) => {
            const [photo] = got;
            if (!photo) return;
            const taken = [...stage.taken, photo];
            held.current = taken;
            if (taken.length >= p.photos) void quote(taken);
            else setStage({ s: "photos", taken });
          }}
        />
        <Button variant="quiet" onClick={p.onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  if (stage.s === "quoting") return <p role="status">Working out the units</p>;
  if (stage.s === "ready" || stage.s === "starting") {
    const { q } = stage;
    return (
      <>
        {q.synthetic ? <SampleBanner /> : null}
        <QuoteSheet
          state={stage.s === "starting" ? "confirmed" : q.quote.overCap ? "over_cap" : "ready"}
          title={p.title}
          lines={groupLines(q)}
          unitsLeft={q.quote.sessionUnitsLeft}
          confirmLabel={p.confirmLabel}
          onConfirm={() => {
            if (stage.s === "ready") void start(stage.taken, q);
          }}
          onCancel={() => {
            for (const ph of stage.taken) void discardPhoto(ph.key);
            held.current = [];
            consumed.current = true;
            p.onCancel();
          }}
        />
      </>
    );
  }
  if (stage.s === "running") {
    return (
      <div className="proof__capture">
        <h2 className="mira-title">{p.title}</h2>
        <StepRail steps={toSteps(view?.nodes ?? [])} label={p.title} />
      </div>
    );
  }
  if (stage.s === "finished") {
    const { view: v } = stage;
    const ok = v.run.status === "succeeded" || v.run.status === "partial";
    const failure = v.nodes.find((n: RunNode) => n.status === "failed" && n.error)?.error;
    if (!ok || (failure && v.run.status !== "succeeded" && p.kind !== "phantom")) {
      return (
        <ErrorPanel
          title={
            v.run.status === "cancelled" ? "The run was stopped." : "This could not be measured."
          }
          {...(failure ? { why: reasonCopy(failure.code) } : {})}
          next="Nothing was recorded. Units are charged only for photos that were measured."
          traceId={v.run.traceId}
          actions={<Button onClick={p.onCancel}>Back</Button>}
        />
      );
    }
    return (
      <div className="proof__capture">
        {v.synthetic ? <SampleBanner /> : null}
        {p.plate ? (
          <>
            <Plate
              state="ready"
              alt={p.plate.alt}
              src={`/api/runs/${stage.runId}/images/${p.plate.node}`}
              strip={<LabelStrip caption={p.plate.caption} variant="visualisation" />}
            />
            <p className="mira-small">
              Previews are deleted {REVIEW_MINUTES} minutes after the run.
            </p>
          </>
        ) : null}
        <Button
          onClick={() => {
            p.onDone({ status: v.run.status, runId: stage.runId });
          }}
        >
          Continue
        </Button>
      </div>
    );
  }
  return (
    <ErrorPanel
      title="That did not start."
      why={stage.message}
      next="Nothing was charged."
      actions={<Button onClick={p.onCancel}>Back</Button>}
    />
  );
}

const STEP_WORDS: Record<string, string> = {
  "step.measure_skin_capture": "Measuring each photo",
  "step.simulate_concern": "Simulating the concern at five strengths",
  "step.measure_simulation": "Measuring each simulation",
  "step.visualise_change": "Drawing the visualisation",
};

function groupLines(q: RunQuoteReply): { label: string; units: number }[] {
  const m = new Map<string, number>();
  for (const l of q.quote.lines) {
    const label = STEP_WORDS[l.label] ?? l.label;
    m.set(label, (m.get(label) ?? 0) + l.units);
  }
  return [...m].map(([label, units]) => ({ label, units }));
}

function SampleBanner() {
  return (
    <Banner kind="info">
      Sample results. The measurements are invented, so nothing here describes you.
    </Banner>
  );
}
