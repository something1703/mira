"use client";

import { LookResult, type RunNode } from "@mira/schemas";
import {
  Banner,
  Button,
  ErrorPanel,
  FidelityLabel,
  LabelStrip,
  Plate,
  StepRail,
  buttonClass,
} from "@mira/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { attachLook, findFunction, loadEvent } from "../../../src/event/store";
import { DRAFT_KEY } from "../../../src/look/api";
import { SLOT_NAMES, STEP_REASONS, verdictLabel } from "../../../src/look/copy";
import { reasonCopy } from "../../../src/profile/copy";
import { RunView } from "../../../src/runs/api";
import { toSteps } from "../../../src/runs/steps";
import { REVIEW_MINUTES } from "../../../src/shade/copy";
import { flash } from "../../../src/shell/flash";
import { SampleBanner } from "./look-studio";

const FINISHED = new Set(["succeeded", "failed", "partial", "cancelled"]);
/** The pictures a look makes, in the order the chain makes them. */
const PICTURES = ["outfit", "shoes", "bag", "makeup", "hair", "venue"] as const;

/** The newest picture the chain has made so far: the plate updates after each step. */
function latestPicture(nodes: readonly RunNode[]): (typeof PICTURES)[number] | undefined {
  return [...PICTURES]
    .reverse()
    .find((id) => nodes.some((n) => n.id === id && (n.status === "done" || n.status === "cached")));
}

export function LookRun({ runId, functionId }: { runId: string; functionId?: string }) {
  const [view, setView] = useState<RunView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const life = { stopped: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (res.status === 404) {
          if (!life.stopped) setProblem("This look could not be found.");
          return;
        }
        const parsed = res.ok ? RunView.safeParse(await res.json()) : undefined;
        if (!parsed?.success) throw new Error("unreadable");
        if (life.stopped) return;
        misses = 0;
        setView(parsed.data);
        setProblem(null);
        if (!FINISHED.has(parsed.data.run.status)) timer = setTimeout(() => void tick(), 900);
      } catch {
        if (life.stopped) return;
        misses += 1;
        if (misses >= 5) setProblem("The look could not be read.");
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
          <Link href="/look" className={buttonClass("primary")}>
            Start again
          </Link>
        }
      />
    );
  }
  if (!view) return <p role="status">Reading the run</p>;

  const { run, nodes } = view;
  const assemble = nodes.find((n) => n.id === "assemble");
  const result = assemble?.status === "done" ? LookResult.safeParse(assemble.output) : undefined;
  if (result?.success) {
    return (
      <Done
        runId={runId}
        view={view}
        result={result.data}
        {...(functionId ? { functionId } : {})}
      />
    );
  }
  if (FINISHED.has(run.status)) {
    const first = nodes.find((n) => n.status === "failed" && n.error)?.error;
    return (
      <div className="look">
        <ErrorPanel
          title={run.status === "cancelled" ? "The look was stopped." : "No look could be made."}
          {...(first ? { why: reasonCopy(first.code) } : {})}
          next="Add the photo again. MIRA quotes it before anything is rendered. Units are charged only for steps that finished."
          traceId={run.traceId}
          actions={
            <Link href="/look" className={buttonClass("primary")}>
              Try again
            </Link>
          }
        />
      </div>
    );
  }
  return <Building runId={runId} view={view} />;
}

function Building({ runId, view }: { runId: string; view: RunView }) {
  const { nodes } = view;
  const steps = toSteps(nodes);
  const picture = latestPicture(nodes);
  const video = nodes.find((n) => n.id === "video");
  const makingVideo = video?.status === "running" || video?.status === "waiting";
  const [stopping, setStopping] = useState(false);
  return (
    <div className="look">
      {view.synthetic ? <SampleBanner /> : null}
      <h1 className="mira-display-l">{makingVideo ? "Making the video" : "Building your look"}</h1>
      <p className="lead">
        {makingVideo
          ? "Your look is ready to see below. The video will follow."
          : "Each step is checked before the next one. The picture updates as steps finish."}
      </p>
      <div className="look__grid">
        <StepRail steps={steps} label="Building your look" />
        <div className="look__stage">
          <Plate
            state={picture ? "ready" : "loading"}
            alt={
              picture ? `Your look so far, after ${SLOT_NAMES[picture]}` : "Your look is starting"
            }
            {...(picture ? { src: `/api/runs/${runId}/images/${picture}` } : {})}
            strip={
              picture ? (
                <LabelStrip
                  caption="Preview so far"
                  variant="not_checked"
                  detail="Checks run as the steps finish."
                />
              ) : undefined
            }
          />
          <Button
            variant="secondary"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              void fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
            }}
          >
            {stopping ? "Stopping after the running step" : "Cancel remaining"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function usePicture(runId: string, node: string | undefined): "unknown" | "ready" | "gone" {
  const [state, setState] = useState<"unknown" | "ready" | "gone">("unknown");
  useEffect(() => {
    if (node === undefined) return;
    let alive = true;
    fetch(`/api/runs/${runId}/images/${node}`, { cache: "no-store" })
      .then((res) => {
        if (alive) setState(res.ok ? "ready" : "gone");
      })
      .catch(() => {
        if (alive) setState("gone");
      });
    return () => {
      alive = false;
    };
  }, [runId, node]);
  return state;
}

function Done({
  runId,
  view,
  result,
  functionId,
}: {
  runId: string;
  view: RunView;
  result: LookResult;
  functionId?: string;
}) {
  const router = useRouter();
  const withheld = result.identity.verdict === "withheld";
  const plate = result.plate;
  const picture = usePicture(runId, plate);
  const [saved, setSaved] = useState(false);
  const [saveProblem, setSaveProblem] = useState(false);
  const [kept, setKept] = useState(false);
  const outfit = result.steps.find((s) => s.id === "outfit");
  const drifted = result.steps.filter((s) => s.verdict === "drift");
  const videoDone = result.video?.status === "done";
  const fn = findFunction(typeof window === "undefined" ? undefined : loadEvent(), functionId);

  const save = async () => {
    if (plate === undefined) return;
    try {
      const res = await fetch(`/api/runs/${runId}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeIds: videoDone ? [plate, "video"] : [plate] }),
      });
      if (!res.ok) throw new Error("save refused");
      const body = (await res.json()) as { lookId?: string };
      if (functionId && body.lookId) attachLook(functionId, body.lookId);
      setSaved(true);
      flash("Look saved");
    } catch {
      setSaveProblem(true);
    }
  };

  const share = async () => {
    const res = await fetch(`/api/runs/${runId}/images/${plate ?? ""}`).catch(() => undefined);
    if (!res?.ok) return;
    const blob = await res.blob();
    const file = new File([blob], "my-look.png", { type: blob.type || "image/png" });
    // Not every browser has a share sheet, so these may be missing at run time.
    const nav = navigator as Partial<Pick<Navigator, "canShare" | "share">>;
    if (nav.canShare?.({ files: [file] })) {
      await nav.share?.({ files: [file], title: "My look" }).catch(() => undefined);
      return;
    }
    // No share sheet on this device: download the picture instead.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-look.png";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const skipFaceSteps = () => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      const draft = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      delete draft.hairHex;
      draft.makeup = false;
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage blocked: the studio opens with the look as it was.
    }
    router.push(functionId ? `/look?fn=${functionId}` : "/look");
  };

  return (
    <div className="look">
      {view.synthetic ? <SampleBanner /> : null}
      <header>
        <h1 className="mira-display-l">{fn ? `Your look for ${fn.name}` : "Your look"}</h1>
      </header>
      <div className="look__grid">
        <div className="look__stage">
          {withheld ? (
            <>
              <Plate state="withheld" alt="A preview that was withheld" />
              <p role="alert">
                Your face changed by more than MIRA allows, so no preview of this look is shown.
              </p>
              <div className="mira-row">
                <Button
                  onClick={() => {
                    router.push(functionId ? `/look?fn=${functionId}` : "/look");
                  }}
                >
                  Retry
                </Button>
                <Button variant="secondary" onClick={skipFaceSteps}>
                  Skip step
                </Button>
              </div>
            </>
          ) : picture === "gone" ? (
            <Plate state="expired" alt="A look that has been deleted" />
          ) : (
            <Plate
              state={outfit?.verdict === "drift" && !kept ? "drift" : "ready"}
              alt="Your look, as built"
              {...(plate ? { src: `/api/runs/${runId}/images/${plate}` } : {})}
              strip={
                <div className="look__labels">
                  {result.steps.map((s) => {
                    const l = verdictLabel(s);
                    return (
                      <FidelityLabel
                        key={s.id}
                        variant={l.variant}
                        {...(l.word ? { word: l.word } : {})}
                        {...(l.detail ? { detail: l.detail } : {})}
                      />
                    );
                  })}
                </div>
              }
            />
          )}
          {!withheld && drifted.length > 0 && !kept ? (
            <div className="look__drift" role="status">
              <p>
                {drifted[0]?.id === "outfit"
                  ? "The garment's colour drifted from the product. Check before buying."
                  : "The lip colour drifted from the product."}
              </p>
              <div className="mira-row">
                <Button
                  onClick={() => {
                    router.push(functionId ? `/look?fn=${functionId}` : "/look");
                  }}
                >
                  Retry this step
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setKept(true);
                  }}
                >
                  Keep
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="look__side">
          <h2 className="mira-title">What was checked</h2>
          <ul className="look__checks">
            <li>
              <FidelityLabel
                variant={result.identity.verdict === "verified" ? "verified" : "not_checked"}
                word={
                  result.identity.verdict === "verified"
                    ? "Your face is unchanged"
                    : result.identity.verdict === "withheld"
                      ? "Your face changed, so the preview was withheld"
                      : "Your face was not compared"
                }
              />
            </li>
            {result.steps
              .filter((s) => s.verdict === "failed" || s.verdict === "skipped")
              .map((s) => (
                <li key={s.id}>
                  {SLOT_NAMES[s.id]}: {STEP_REASONS[s.reason ?? ""] ?? reasonCopy(s.reason ?? "")}
                </li>
              ))}
          </ul>
          {result.video && result.video.status !== "not_requested" ? (
            <div className="look__video">
              <h2 className="mira-title">Motion</h2>
              {result.video.status === "done" ? (
                <LookVideo runId={runId} />
              ) : (
                <p>
                  No video was made.{" "}
                  {STEP_REASONS[result.video.reason ?? ""] ?? "A step before it did not finish."}
                </p>
              )}
            </div>
          ) : null}
          <p className="mira-small">
            Previews are deleted {REVIEW_MINUTES} minutes after the run unless you save the look.
          </p>
          {saveProblem ? (
            <p role="alert">The look could not be saved. It may already have been deleted.</p>
          ) : null}
          <div className="mira-row">
            <Button disabled={saved || withheld || picture === "gone"} onClick={() => void save()}>
              {saved ? "Saved" : "Save look"}
            </Button>
            <Button
              variant="secondary"
              disabled={withheld || picture === "gone"}
              onClick={() => void share()}
            >
              Share
            </Button>
            <Link
              href={functionId ? `/look?fn=${functionId}` : "/look"}
              className={buttonClass("secondary")}
            >
              Change one item
            </Link>
            {functionId ? (
              <Link href="/event" className={buttonClass("quiet")}>
                Back to the event
              </Link>
            ) : null}
          </div>
          {saved ? <Banner kind="info">Look saved.</Banner> : null}
        </div>
      </div>
    </div>
  );
}

/** The video, or the still it was made from when the browser cannot play it (mock mode). */
function LookVideo({ runId }: { runId: string }) {
  const [still, setStill] = useState(false);
  const src = `/api/runs/${runId}/images/video`;
  return still ? (
    // eslint-disable-next-line @next/next/no-img-element -- a run output from our own storage
    <img src={src} alt="A still from the sample video" className="look__videoimg" />
  ) : (
    <video
      src={src}
      controls
      className="look__videoimg"
      onError={() => {
        setStill(true);
      }}
    >
      <track kind="captions" />
    </video>
  );
}
