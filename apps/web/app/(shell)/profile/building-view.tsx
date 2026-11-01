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

  useEffect(() => {
    const life = { stopped: false };
    const gone = () => life.stopped;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "This measuring run could not be found."
              : "The measuring run could not be read.",
          );
        }
        const parsed = RunView.parse(await res.json());
        if (life.stopped) return;
        setView(parsed);
        setProblem(null);
        const over = FINISHED.has(parsed.run.status);
        if (over && parsed.run.status !== "failed" && parsed.run.status !== "cancelled") {
          // Confirm the profile exists (this also refreshes the Welcome screen's state), then show it.
          await fetch("/api/twin", { cache: "no-store" });
          if (!gone()) router.replace("/profile");
          return;
        }
        if (!over) timer = setTimeout(() => void tick(), 700);
      } catch (error) {
        if (!gone())
          setProblem(error instanceof Error ? error.message : "The run could not be read.");
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
        <Ring mode="run" label="Measuring progress" steps={steps} />
        <div className="mira-panel">
          <StepRail label="Steps in this run" steps={steps} />
          <div className="mira-row">
            <Button
              variant="secondary"
              disabled={cancelling}
              onClick={() => {
                setCancelling(true);
                void fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
              }}
            >
              {cancelling ? "Stopping" : "Cancel"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
