"use client";

import { Button, ErrorPanel, Ring, StepRail, buttonClass } from "@mira/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RunView } from "../../../src/runs/api";
import { toSteps } from "../../../src/runs/steps";
import { reasonCopy } from "../../../src/profile/copy";
import { later } from "../../../src/routes";

const FINISHED = new Set(["succeeded", "failed", "partial", "cancelled"]);

/**
 * Building (docs/UX_FLOWS.md §4): the steps light up as they finish. When the run ends and its
 * cleanup is recorded, the profile appears. If nothing could be measured there is no profile, so
 * this says why for each step and offers a retake. Cancel stops steps that have not started.
 */
export function BuildingView({ runId }: { runId: string }) {
  const router = useRouter();
  const [view, setView] = useState<RunView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);

  useEffect(() => {
    const life = { stopped: false };
    const gone = () => life.stopped;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (res.status === 404) {
          setProblem("This measuring run could not be found.");
          return;
        }
        const parsed = res.ok ? RunView.safeParse(await res.json()) : undefined;
        if (!parsed?.success) throw new Error("unreadable");
        if (life.stopped) return;
        misses = 0;
        setView(parsed.data);
        setProblem(null);
        const over = FINISHED.has(parsed.data.run.status);
        if (over && parsed.data.run.status !== "failed" && parsed.data.run.status !== "cancelled") {
          // Confirm the profile exists (this also refreshes the Welcome screen's state), then show it.
          await fetch("/api/twin", { cache: "no-store" });
          if (!gone()) router.replace("/profile");
          return;
        }
        if (!over) timer = setTimeout(() => void tick(), 700);
      } catch {
        if (gone()) return;
        // One dropped request is not the end of a run: look again, and only after several misses in
        // a row say that it cannot be read. The run itself carries on without this page.
        misses += 1;
        if (misses >= 5) setProblem("The measuring run could not be read.");
        else timer = setTimeout(() => void tick(), Math.min(5_000, 700 * 2 ** misses));
      }
    };
    void tick();
    return () => {
      life.stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, router]);

  if (problem) {
    return (
      <ErrorPanel
        title={problem}
        next="Go to your profile to see what was saved, or measure again."
        actions={
          <>
            <Link href="/profile" className={buttonClass("secondary")}>
              Your profile
            </Link>
            <Link href={later("/capture")} className={buttonClass("primary")}>
              Measure again
            </Link>
          </>
        }
      />
    );
  }
  if (!view) return <p role="status">Reading the run</p>;

  const { run, nodes } = view;
  const steps = toSteps(nodes);
  if (run.status === "failed" || run.status === "cancelled") {
    const firstError = nodes.find((n) => n.status === "failed" && n.error)?.error;
    const why = firstError
      ? reasonCopy(firstError.code)
      : run.status === "cancelled"
        ? "No profile was saved."
        : undefined;
    return (
      <div className="profile">
        <ErrorPanel
          title={
            run.status === "cancelled" ? "Measuring was stopped." : "Nothing could be measured."
          }
          {...(why ? { why } : {})}
          next="Take the photo again and MIRA will quote it before measuring."
          traceId={run.traceId}
          actions={
            <Link href={later("/capture")} className={buttonClass("primary")}>
              Retake
            </Link>
          }
        />
        <StepRail label="Steps in this run" steps={steps} />
      </div>
    );
  }

  return (
    <div className="profile profile--building">
      <h1 className="mira-display-l">Measuring you</h1>
      <p className="lead">
        Each step finishes on its own. Your photos are deleted when the run ends.
      </p>
      <div className="runview__grid">
        <Ring mode="run" label="Measuring progress" steps={steps} announce={false} />
        <div className="mira-panel">
          <StepRail label="Steps in this run" steps={steps} />
          <div className="mira-row">
            <Button
              variant="secondary"
              disabled={cancelling}
              onClick={() => {
                setCancelling(true);
                setCancelFailed(false);
                fetch(`/api/runs/${runId}/cancel`, { method: "POST" })
                  .then((res) => {
                    if (!res.ok) throw new Error("cancel refused");
                  })
                  .catch(() => {
                    setCancelling(false);
                    setCancelFailed(true);
                  });
              }}
            >
              {cancelling ? "Stopping" : "Cancel"}
            </Button>
            {cancelFailed ? (
              <p role="status" className="mira-small">
                The run could not be stopped just now. Steps already started will finish.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
