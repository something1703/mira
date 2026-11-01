"use client";

import {
  Banner,
  Button,
  ErrorPanel,
  FidelityLabel,
  LabelStrip,
  Plate,
  Ring,
  StepRail,
  buttonClass,
  type Step,
} from "@mira/ui";
import type { RunNode, ShadeOutcome } from "@mira/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { reasonCopy } from "../../../src/profile/copy";
import { RunView } from "../../../src/runs/api";
import { toSteps } from "../../../src/runs/steps";
import { CONCEALER_KEY, RANGE_KEY, RETRY_KEY, ShadeResult } from "../../../src/shade/api";
import {
  COVERAGE_WORD,
  FINISH_WORD,
  REVIEW_MINUTES,
  SHADE_REASONS,
  coverageWhy,
  finishWhy,
  readsLike,
} from "../../../src/shade/copy";
import { flash } from "../../../src/shell/flash";
import { later } from "../../../src/routes";

const FINISHED = new Set(["succeeded", "failed", "partial", "cancelled"]);

/** The shade names the run was started with, from its last step's parameters. */
function shadeNames(nodes: readonly RunNode[]): { id: string; name: string; hex: string }[] {
  const p = nodes.find((n) => n.id === "assemble")?.params as
    { shades?: { id: string; name: string; hex: string }[] } | undefined;
  return p?.shades ?? [];
}

/** Steps with the shade's own name in them: "Trying Honey 140", not "Rendering a preview". */
function namedSteps(nodes: readonly RunNode[]): Step[] {
  const names = shadeNames(nodes);
  const byIndex = (id: string) => Number(/-(\d+)$/.exec(id)?.[1] ?? 0) - 1;
  return toSteps(nodes).map((step) => {
    const shade = names[byIndex(step.id)];
    if (!shade) return step;
    const word = step.id.startsWith("render")
      ? "Trying"
      : step.id.startsWith("measure")
        ? "Measuring"
        : "Checking";
    return { ...step, label: `${word} ${shade.name}` };
  });
}

/** Whether a preview image can still be fetched: it is deleted when the review window closes. */
function usePreview(
  runId: string,
  node: string | undefined,
  enabled: boolean,
): "unknown" | "ready" | "gone" {
  const [state, setState] = useState<"unknown" | "ready" | "gone">("unknown");
  useEffect(() => {
    if (!enabled || node === undefined) return;
    let alive = true;
    fetch(`/api/runs/${runId}/images/${node}`, { method: "GET", cache: "no-store" })
      .then((res) => {
        if (alive) setState(res.ok ? "ready" : "gone");
      })
      .catch(() => {
        if (alive) setState("gone");
      });
    return () => {
      alive = false;
    };
  }, [runId, node, enabled]);
  return state;
}

export function ShadeRun({ runId }: { runId: string }) {
  const [view, setView] = useState<RunView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const life = { stopped: false };
    const gone = () => life.stopped;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (res.status === 404) {
          setProblem("This shade run could not be found.");
          return;
        }
        const parsed = res.ok ? RunView.safeParse(await res.json()) : undefined;
        if (!parsed?.success) throw new Error("unreadable");
        if (gone()) return;
        misses = 0;
        setView(parsed.data);
        setProblem(null);
        if (!FINISHED.has(parsed.data.run.status)) timer = setTimeout(() => void tick(), 900);
      } catch {
        if (gone()) return;
        misses += 1;
        if (misses >= 5) setProblem("The shade run could not be read.");
        else timer = setTimeout(() => void tick(), Math.min(5_000, 900 * 2 ** misses));
      }
    };
    void tick();
    return () => {
      life.stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  if (problem) {
    return (
      <ErrorPanel
        title={problem}
        next="Nothing is lost: your profile is unchanged."
        actions={
          <Link href="/shade" className={buttonClass("primary")}>
            Start again
          </Link>
        }
      />
    );
  }
  if (!view) return <p role="status">Reading the run</p>;

  const { run, nodes } = view;
  const assemble = nodes.find((n) => n.id === "assemble");
  const result = assemble?.status === "done" ? ShadeResult.safeParse(assemble.output) : undefined;
  if (result?.success) {
    return <Results runId={runId} run={view} result={result.data} />;
  }
  if (FINISHED.has(run.status)) {
    // The run is over and nothing could be measured.
    const first = nodes.find((n) => n.status === "failed" && n.error)?.error;
    return (
      <div className="shade">
        <ErrorPanel
          title={
            run.status === "cancelled" ? "Rendering was stopped." : "No shade could be measured."
          }
          {...(first ? { why: reasonCopy(first.code) } : {})}
          next="Take the photo again. MIRA quotes it before anything is rendered."
          traceId={run.traceId}
          actions={
            <Link href="/shade" className={buttonClass("primary")}>
              Try again
            </Link>
          }
        />
      </div>
    );
  }

  const steps = namedSteps(nodes);
  const renders = nodes.filter((n) => n.id.startsWith("render-"));
  const names = shadeNames(nodes);
  return (
    <div className="shade">
      {view.synthetic ? <SampleBanner /> : null}
      <h1 className="mira-display-l">Trying the closest shades</h1>
      <p className="lead">
        Each shade is rendered unretouched, then measured. Previews appear as they finish.
      </p>
      <div className="shade__plates">
        {renders.map((n, i) => (
          <Plate
            key={n.id}
            state={n.status === "done" || n.status === "cached" ? "ready" : "loading"}
            alt={`Preview of ${names[i]?.name ?? "a shade"}`}
            {...(n.status === "done" ? { src: `/api/runs/${runId}/images/${n.id}` } : {})}
          />
        ))}
      </div>
      <div className="runview__grid">
        <Ring mode="run" label="Shade matching progress" steps={steps} announce={false} />
        <div className="mira-panel">
          <StepRail label="Steps in this run" steps={steps} />
          <Button
            variant="secondary"
            onClick={() => {
              void fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
            }}
          >
            Cancel remaining
          </Button>
        </div>
      </div>
    </div>
  );
}

function SampleBanner() {
  return (
    <Banner kind="info">
      Sample results. The previews are placeholder pictures and the measurements are invented, so
      nothing here describes you.
    </Banner>
  );
}

const ΔE = (n: number) => n.toFixed(1);

function Results({
  runId,
  run: view,
  result,
}: {
  runId: string;
  run: RunView;
  result: ShadeResult;
}) {
  const router = useRouter();
  const best = result.outcomes.find((o) => o.shadeId === result.bestShadeId);
  const lead = best ?? result.outcomes.find((o) => o.verdict !== "failed");
  const others = result.outcomes.filter((o) => o !== lead);
  const failed = result.outcomes.filter(
    (o) => o.verdict === "failed" && o.reason !== "not_rendered",
  );
  const rendered = result.outcomes.filter((o) => o.verdict !== "failed").length;
  const preview = usePreview(runId, lead?.renderNode, true);
  const [saved, setSaved] = useState(false);
  const [saveProblem, setSaveProblem] = useState(false);

  const save = async () => {
    const nodes = result.outcomes.flatMap((o) =>
      o.verdict !== "failed" && o.renderNode ? [o.renderNode] : [],
    );
    try {
      const res = await fetch(`/api/runs/${runId}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeIds: lead?.renderNode ? [lead.renderNode] : nodes.slice(0, 1) }),
      });
      if (!res.ok) throw new Error("save refused");
      setSaved(true);
      flash("Look saved");
    } catch {
      setSaveProblem(true);
    }
  };

  const addConcealer = () => {
    if (!lead) return;
    let kept = false;
    try {
      kept = sessionStorage.getItem(RANGE_KEY) !== null;
      sessionStorage.setItem(RETRY_KEY, JSON.stringify([lead.shadeId]));
      sessionStorage.setItem(CONCEALER_KEY, "1");
    } catch {
      kept = false;
    }
    router.push(kept ? "/shade?retry=1" : "/shade");
  };

  const retryMissing = () => {
    // The range is needed again to rank and quote the shades that failed; it was kept in this tab.
    let kept = false;
    try {
      kept = sessionStorage.getItem(RANGE_KEY) !== null;
      sessionStorage.setItem(RETRY_KEY, JSON.stringify(failed.map((o) => o.shadeId)));
      sessionStorage.removeItem(CONCEALER_KEY);
    } catch {
      kept = false;
    }
    router.push(kept ? "/shade?retry=1" : "/shade");
  };

  return (
    <div className="shade">
      {view.synthetic ? <SampleBanner /> : null}
      <header>
        <h1 className="mira-display-l">
          {best ? `${best.name} is your closest match` : "No shade in this range blends closely"}
        </h1>
        <p className="lead">
          {best
            ? "It was rendered unretouched, then measured against your skin."
            : `The closest shade, ${lead?.name ?? "shown below"}, ${readsLike(result.closestLabel)} your skin.`}
        </p>
      </header>

      {rendered < result.outcomes.length ? (
        <Banner kind="info">
          {rendered} of {result.outcomes.length} shades rendered.
          {failed.length > 0 ? " The rest are listed below, with why." : ""}
        </Banner>
      ) : null}

      {lead ? (
        <section aria-labelledby="sh-best" className="shade__best">
          <h2 id="sh-best" className="mira-title">
            {best ? "Best match" : "Closest shade"}
          </h2>
          {preview === "gone" ? (
            <Plate state="expired" alt={`Preview of ${lead.name}`} />
          ) : (
            <Plate
              state={preview === "ready" ? "ready" : "loading"}
              alt={`Unretouched preview of ${lead.name}`}
              {...(preview === "ready" && lead.renderNode
                ? { src: `/api/runs/${runId}/images/${lead.renderNode}` }
                : {})}
              strip={
                <Strip
                  outcome={lead}
                  calibrated={result.thresholds.calibrated}
                  concealer={result.concealer}
                  matchDe={result.thresholds.matchDe}
                />
              }
            />
          )}
          <p className="mira-body">
            {lead.name}, rendered in {FINISH_WORD[result.finish]} finish with{" "}
            {COVERAGE_WORD[result.coverage]} coverage.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="sh-why" className="shade__section">
        <h2 id="sh-why" className="mira-title">
          Why this finish and coverage
        </h2>
        <p>{finishWhy(result.finishReason)}</p>
        <p>{coverageWhy(result.coverageReason)}</p>
        {result.tZoneNote ? (
          <p>Your T-zone and the rest of your face may read differently.</p>
        ) : null}
        <p className="mira-small mira-muted">
          These are style rules MIRA applies to your readings, not advice about your skin.
          {result.thresholds.calibrated
            ? ""
            : " What counts as a close match is a starting value that has not been calibrated yet."}
        </p>
      </section>

      {others.length > 0 ? (
        <section aria-labelledby="sh-others" className="shade__section">
          <h2 id="sh-others" className="mira-title">
            Other shades tried
          </h2>
          <ul className="shade__rows">
            {others.map((o) => (
              <li key={o.shadeId} className="shade__row">
                <span className="shade__chip" style={{ background: o.hex }} aria-hidden="true" />
                <span>
                  <span className="mira-title">{o.name}</span>{" "}
                  {o.verdict === "failed" ? (
                    <span className="mira-small mira-muted">
                      Not rendered.{" "}
                      {SHADE_REASONS[o.reason ?? ""] ?? reasonCopy(o.reason ?? "could_not_measure")}
                    </span>
                  ) : (
                    <FidelityLabel
                      variant={o.verdict === "drift" ? "drift" : "verified"}
                      {...(o.verdict === "drift"
                        ? {
                            detail:
                              "The render moved your skin colour the wrong way, so it is not ranked.",
                          }
                        : { detail: `blends within ΔE ${ΔE(o.blendDe ?? 0)}` })}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mira-small mira-muted">
        Previews are deleted {REVIEW_MINUTES} minutes after the run unless you save one.
      </p>
      {saveProblem ? (
        <Banner kind="info">
          The preview could not be saved. It may already have been deleted.
        </Banner>
      ) : null}
      <div className="mira-row">
        {lead?.renderNode ? (
          <Button disabled={saved || preview === "gone"} onClick={() => void save()}>
            {saved ? "Saved" : "Save this preview"}
          </Button>
        ) : null}
        {result.concealerSuggested && !result.concealer && lead && lead.verdict === "verified" ? (
          <Button variant="secondary" onClick={addConcealer}>
            Add a concealer to {lead.name}
          </Button>
        ) : null}
        {failed.length > 0 ? (
          <Button variant="secondary" onClick={retryMissing}>
            Retry missing
          </Button>
        ) : null}
        <Link href={later("/look")} className={buttonClass("secondary")}>
          Build a look with this
        </Link>
        <Link href="/shade" className={buttonClass("quiet")}>
          Try another range
        </Link>
      </div>
    </div>
  );
}

function Strip({
  outcome,
  matchDe,
  calibrated,
  concealer,
}: {
  outcome: ShadeOutcome;
  concealer: boolean;
  matchDe: number;
  calibrated: boolean;
}) {
  const verified = outcome.verdict === "verified";
  return (
    <LabelStrip
      caption={`Unretouched preview of ${outcome.name}${concealer ? " with concealer" : ""}, smoothing off`}
      variant={verified ? "verified" : "drift"}
      detail={
        verified
          ? `blends within ΔE ${ΔE(outcome.blendDe ?? 0)}${(outcome.blendDe ?? 0) <= matchDe ? "" : " of your skin"}${calibrated ? "" : " (starting threshold)"}`
          : "colour drifted: the render moved your skin colour the wrong way"
      }
    />
  );
}
