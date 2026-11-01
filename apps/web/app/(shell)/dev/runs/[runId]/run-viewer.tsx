"use client";

import { Banner, Button, ErrorPanel, FidelityLabel, Reading, Ring, StepRail } from "@mira/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RunView } from "../../../../../src/runs/api";
import { stepLabel, toSteps } from "../../../../../src/runs/steps";

const FINISHED = new Set(["succeeded", "failed", "partial", "cancelled"]);
const RUN_WORDS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  partial: "Partly done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** The graph lighting up node by node, with units, cache hits, audits and the ledger. */
export function RunViewer({ runId }: { runId: string }) {
  const [view, setView] = useState<RunView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/dev/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok)
          throw new Error(
            res.status === 404 ? "This run does not exist." : "The run could not be read.",
          );
        const parsed = RunView.parse(await res.json());
        if (stopped) return;
        setView(parsed);
        setProblem(null);
        // Keep reading until the run has finished and its cleanup has been recorded.
        if (!FINISHED.has(parsed.run.status) || parsed.run.cleanedAt === undefined)
          timer = setTimeout(() => void tick(), 700);
      } catch (error) {
        if (stopped) return;
        setProblem(error instanceof Error ? error.message : "The run could not be read.");
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  if (problem) {
    return (
      <ErrorPanel
        title={problem}
        next="Start a new demo run, or go back to the list."
        actions={
          <Link className="mira-btn mira-btn--secondary" href="/dev/runs">
            Back to the run viewer
          </Link>
        }
      />
    );
  }
  if (!view) return <p role="status">Reading the run</p>;

  const { run, nodes, ledger, synthetic } = view;
  const steps = toSteps(nodes);
  const settled = FINISHED.has(run.status);
  const units = (kind: string) =>
    ledger.filter((e) => e.kind === kind).reduce((n, e) => n + e.units, 0);

  return (
    <div className="runview">
      {synthetic ? (
        <Banner kind="info">
          This is a synthetic demo run. YouCam is replaced by a test double, so none of these are
          real measurements.
        </Banner>
      ) : null}
      <div className="runview__head">
        <div>
          <h1 className="mira-display-l">{RUN_WORDS[run.status] ?? run.status}</h1>
          <p className="mira-small mira-muted">
            Run {run.id} · trace {run.traceId}
          </p>
        </div>
        <Reading
          caption="Units spent"
          value={String(run.unitsSpent)}
          unit="units"
          {...(nodes.some((n) => n.status === "cached")
            ? { confidence: "Saved results cost nothing" }
            : {})}
        />
      </div>

      <div className="runview__grid">
        <Ring mode="run" label={`Run ${RUN_WORDS[run.status] ?? run.status}`} steps={steps} />
        <div className="mira-panel">
          <StepRail label="Steps in this run" steps={steps} />
        </div>
      </div>

      <section aria-labelledby="rv-nodes">
        <h2 id="rv-nodes" className="mira-title">
          Steps
        </h2>
        <table className="runview__table">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Feature</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Reserved
              </th>
              <th scope="col" className="num">
                Committed
              </th>
              <th scope="col">Audit</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <th scope="row">{stepLabel(n.label)}</th>
                <td>{n.feature ?? "local"}</td>
                <td>{n.status === "cached" ? "Saved result" : n.status}</td>
                <td className="num mira-figures">{n.unitsReserved}</td>
                <td className="num mira-figures">{n.unitsCommitted}</td>
                <td>
                  {n.audit ? (
                    <FidelityLabel
                      variant={
                        n.audit.outcome === "drift"
                          ? "drift"
                          : n.audit.outcome === "verified"
                            ? "verified"
                            : "not_checked"
                      }
                      detail={n.audit.reason}
                    />
                  ) : (
                    "None"
                  )}
                  {n.error ? <span className="mira-small"> {n.error.code}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="rv-ledger">
        <h2 id="rv-ledger" className="mira-title">
          Ledger
        </h2>
        {ledger.length === 0 ? (
          <p className="mira-small mira-muted">
            No units were reserved. Saved results do not reserve any.
          </p>
        ) : (
          <table className="runview__table">
            <thead>
              <tr>
                <th scope="col">Entry</th>
                <th scope="col">Step</th>
                <th scope="col">Feature</th>
                <th scope="col" className="num">
                  Units
                </th>
              </tr>
            </thead>
            <tbody>
              {[...ledger]
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((e) => (
                  <tr key={e.id}>
                    <th scope="row">{e.kind}</th>
                    <td>{e.nodeId}</td>
                    <td>{e.feature}</td>
                    <td className="num mira-figures">{e.units}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <p className="mira-small mira-muted" data-testid="ledger-totals">
          Reserved {units("reserve")}, committed {units("commit")}, released {units("release")}.
        </p>
      </section>

      {settled ? (
        <div className="mira-row">
          <RunAgain />
          <Link className="mira-btn mira-btn--quiet" href="/dev/runs">
            Back to the run viewer
          </Link>
          <p className="mira-small mira-muted">
            {run.cleanedAt
              ? "Images and YouCam tasks for this run have been deleted."
              : "Deleting this run's images and tasks"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RunAgain() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      busy={busy}
      onClick={() => {
        setBusy(true);
        void fetch("/dev/api/runs", { method: "POST" })
          .then((r) => r.json() as Promise<{ runId: string }>)
          .then(({ runId }) => {
            router.push(`/dev/runs/${runId}`);
          })
          .catch(() => {
            setBusy(false);
          });
      }}
    >
      Run it again
    </Button>
  );
}
