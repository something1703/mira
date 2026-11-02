"use client";

import { CONFIG, type ProofRecord, type Verdict } from "@mira/schemas";
import { Banner, Button, Dialog, ErrorPanel, Reading, buttonClass } from "@mira/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProofView as View } from "../../../src/proof/api";
import {
  CONFOUND_WARNING,
  PHANTOM_UNUSABLE,
  PREVIEW_LABEL,
  PROOF_REASONS,
  VISUALISATION_LABEL,
  calendarFile,
  claimSentence,
  concernSubject,
  verdictSentence,
} from "../../../src/proof/copy";
import { Timeline } from "../../../src/proof/timeline";
import { flash } from "../../../src/shell/flash";
import { RunCapture } from "./run-capture";

type Mode =
  | { m: "overview" }
  | { m: "baseline" }
  | { m: "calibrate" }
  | { m: "preview" }
  | { m: "ask_confound" }
  | { m: "check_in"; confound: boolean }
  | { m: "visualise" };

const SNOOZE_KEY = "mira-proof-snooze";

const post = async (path: string, body: unknown = {}) => {
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
    ? (PROOF_REASONS[code] ?? "That did not work.")
    : "That did not work.";
};

export function ProofView({ proofId }: { proofId: string }) {
  const router = useRouter();
  const [view, setView] = useState<View | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [mode, setMode] = useState<Mode>({ m: "overview" });
  const [now, setNow] = useState<number | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [keepAnyway, setKeepAnyway] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proof/${proofId}`, { cache: "no-store" });
      if (res.status === 404) {
        setProblem("That product could not be found.");
        return;
      }
      const parsed = res.ok ? View.safeParse(await res.json()) : undefined;
      if (!parsed?.success) throw new Error("unreadable");
      setView(parsed.data);
      setNow(Date.now());
    } catch {
      setProblem("The product could not be read.");
    }
  }, [proofId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the proof is loaded when the screen opens
    void load();
    try {
      const until = Number(localStorage.getItem(`${SNOOZE_KEY}-${proofId}`) ?? 0);

      setSnoozed(until > Date.now());
    } catch {
      setSnoozed(false);
    }
  }, [load, proofId]);

  if (problem) {
    return (
      <ErrorPanel
        title={problem}
        actions={
          <Link href="/proof" className={buttonClass("primary")}>
            All products
          </Link>
        }
      />
    );
  }
  if (!view || now === undefined) return <p role="status">Opening your progress check</p>;

  const { proof } = view;
  const back = () => {
    setMode({ m: "overview" });
    void load();
  };

  // ---- the capture flows, which replace the overview while they run ----
  if (mode.m === "baseline" || mode.m === "check_in") {
    const checkIn = mode.m === "check_in";
    return (
      <RunCapture
        kind="session"
        photos={CONFIG.proof.capturesPerSession.value}
        label={checkIn ? "Photo for your check-in" : "Photo for your baseline"}
        title={checkIn ? "Check in" : "Add a baseline session"}
        confirmLabel={checkIn ? "Check in" : "Add this session"}
        proofId={proof.id}
        body={{
          kind: checkIn ? "check_in" : "baseline",
          ...(checkIn && mode.confound ? { confound: true } : {}),
        }}
        onDone={() => {
          back();
        }}
        onCancel={back}
      />
    );
  }
  if (mode.m === "calibrate") {
    return (
      <RunCapture
        kind="phantom"
        photos={1}
        label="Photo for calibration"
        title="Calibrate the visualisation"
        confirmLabel="Calibrate"
        proofId={proof.id}
        body={{}}
        onDone={back}
        onCancel={back}
      />
    );
  }
  if (mode.m === "preview" || mode.m === "visualise") {
    const preview = mode.m === "preview";
    return (
      <RunCapture
        kind="visual"
        photos={1}
        label="Photo for the visualisation"
        title={preview ? "Preview the smallest detectable change" : "Show what this looks like"}
        confirmLabel="Show it"
        proofId={proof.id}
        body={{ target: preview ? "preview" : "verdict" }}
        plate={{
          node: "visual",
          caption: preview ? PREVIEW_LABEL : VISUALISATION_LABEL,
          alt: "A visualisation of today's photo with the concern shown more visible",
        }}
        onDone={back}
        onCancel={back}
      />
    );
  }
  if (mode.m === "ask_confound") {
    return (
      <div className="proof">
        <h1 className="mira-display-l">Before you check in</h1>
        <p className="lead">
          Has anything else in your routine changed since your last check-in, such as another
          product, a new cleanser or a change of weather?
        </p>
        <div className="mira-row">
          <Button
            onClick={() => {
              setMode({ m: "check_in", confound: false });
            }}
          >
            No, nothing changed
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setMode({ m: "check_in", confound: true });
            }}
          >
            Yes, something changed
          </Button>
          <Button variant="quiet" onClick={back}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ---- the overview ----
  const last = proof.verdicts.at(-1);
  const due = view.nextDue === undefined ? undefined : Date.parse(view.nextDue);
  const isDue = due !== undefined && now >= due && proof.status === "tracking";
  const gapMs = CONFIG.proof.minSessionGapHours.value * 3_600_000;
  const lastSession = proof.sessions.at(-1);
  const soonest = lastSession ? Date.parse(lastSession.at) + gapMs : 0;
  const canCapture = now >= soonest;

  const act = async (action: "begin" | "stop" | "confound") => {
    const res = await post(`/api/proof/${proof.id}/${action}`);
    if (res.status === 200) {
      setNote(undefined);
      await load();
    } else {
      setNote(reasonOf(res.json));
    }
  };

  const publish = async () => {
    const res = await post(`/api/proof/${proof.id}/review`, { consent: true });
    setReviewOpen(false);
    if (res.status === 201) {
      flash("Review published");
      await load();
    } else {
      setNote(reasonOf(res.json));
    }
  };

  const remove = async () => {
    const res = await fetch(`/api/proof/${proof.id}`, { method: "DELETE" });
    if (res.status === 204) {
      flash("Product removed");
      router.push("/proof");
    } else {
      setNote("That could not be removed.");
    }
  };

  const downloadCalendar = () => {
    const at = view.nextDue === undefined ? new Date(now + 86_400_000) : new Date(view.nextDue);
    const url = URL.createObjectURL(
      new Blob([calendarFile(proof.product.name, at)], { type: "text/calendar" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "mira-check-in.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  const snooze = () => {
    try {
      localStorage.setItem(`${SNOOZE_KEY}-${proofId}`, String(now + 86_400_000));
    } catch {
      // Storage blocked: the reminder simply stays.
    }
    setSnoozed(true);
  };

  return (
    <div className="proof">
      {view.synthetic ? (
        <Banner kind="info">
          Sample results. The measurements are invented, so nothing here describes you.
        </Banner>
      ) : null}
      <header>
        <p>
          <Link href="/proof">All products</Link>
        </p>
        <h1 className="mira-display-l">{proof.product.name}</h1>
        <p className="lead">{claimSentence(proof.claim)}</p>
      </header>
      {note ? <p role="alert">{note}</p> : null}

      {proof.status === "baseline" ? (
        <Baseline
          proof={proof}
          canCapture={canCapture}
          soonest={soonest}
          onCapture={() => {
            setMode({ m: "baseline" });
          }}
        />
      ) : null}

      {proof.status === "ready" ? (
        <Ready
          proof={proof}
          onCalibrate={() => {
            setMode({ m: "calibrate" });
          }}
          onPreview={() => {
            setMode({ m: "preview" });
          }}
          onBegin={() => void act("begin")}
        />
      ) : null}

      {proof.status === "tracking" || proof.status === "ended" || proof.status === "stopped" ? (
        <>
          {isDue && !snoozed ? (
            <Banner kind="info">
              Check-in due. Take three photos in the same light as before.
            </Banner>
          ) : null}
          {last ? (
            <VerdictCard proof={proof} verdict={last} />
          ) : (
            <p>No check-in yet. Your first one is due a week after you started.</p>
          )}
          {proof.confound.flagged && !keepAnyway && proof.status === "tracking" ? (
            <div className="proof__warning" role="alert">
              <p>{CONFOUND_WARNING}</p>
              <div className="mira-row">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setKeepAnyway(true);
                  }}
                >
                  Keep tracking anyway
                </Button>
                <Button variant="secondary" onClick={() => void act("stop")}>
                  Pause
                </Button>
              </div>
            </div>
          ) : null}
          {proof.confound.flagged && keepAnyway ? (
            <p className="mira-small">{CONFOUND_WARNING}</p>
          ) : null}
        </>
      ) : null}

      {proof.sessions.length > 0 ? <Timeline proof={proof} /> : null}

      <div className="mira-row">
        {proof.status === "tracking" ? (
          <>
            <Button
              disabled={!canCapture}
              onClick={() => {
                setMode({ m: "ask_confound" });
              }}
            >
              Check in now
            </Button>
            {isDue && !snoozed ? (
              <Button variant="secondary" onClick={snooze}>
                Remind me tomorrow
              </Button>
            ) : null}
            <Button variant="secondary" onClick={downloadCalendar}>
              Add a reminder to my calendar
            </Button>
            {last?.state === "detected" && proof.phantom?.usable ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setMode({ m: "visualise" });
                }}
              >
                Show what this looks like
              </Button>
            ) : null}
            {!proof.confound.flagged ? (
              <Button variant="quiet" onClick={() => void act("confound")}>
                I started another product
              </Button>
            ) : null}
            <Button variant="quiet" onClick={() => void act("stop")}>
              Stop tracking
            </Button>
          </>
        ) : null}
        {proof.status === "ended" && proof.reviewPublishedAt === undefined ? (
          <>
            <Button
              onClick={() => {
                setReviewOpen(true);
              }}
            >
              Leave a measured review
            </Button>
            <Button variant="quiet" onClick={() => void act("stop")}>
              Stop tracking
            </Button>
          </>
        ) : null}
        {proof.reviewPublishedAt !== undefined ? (
          <p role="status">Review published, anonymously. Thank you.</p>
        ) : null}
        {proof.status === "stopped" || proof.status === "ended" ? (
          <Button variant="quiet" onClick={() => void remove()}>
            Remove this product
          </Button>
        ) : null}
      </div>

      <Dialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title="Leave a measured review?"
        description="This publishes one anonymous outcome. It does not name you or include a photo."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setReviewOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void publish()}>Publish</Button>
          </>
        }
      >
        <p>
          What is shared: the product, the concern, the size of the change, how it compared with
          your day-to-day variation, your skin-tone band and the week. Nothing else.
        </p>
      </Dialog>
    </div>
  );
}

function Baseline({
  proof,
  canCapture,
  soonest,
  onCapture,
}: {
  proof: ProofRecord;
  canCapture: boolean;
  soonest: number;
  onCapture: () => void;
}) {
  const n = proof.sessions.filter((s) => s.kind === "baseline").length;
  const total = CONFIG.proof.baselineSessions.value;
  return (
    <section className="proof__section" aria-labelledby="baseline-h">
      <h2 id="baseline-h" className="mira-title">
        Baseline needed
      </h2>
      <p>
        MIRA needs {String(total)} captures on different days to learn your day-to-day variation.
      </p>
      <p role="status" aria-label={`${String(n)} of ${String(total)} sessions done`}>
        <progress max={total} value={n} /> {String(n)} of {String(total)}
      </p>
      {!canCapture ? (
        <p className="mira-small">
          Your next session can be taken after{" "}
          {new Date(soonest).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.
        </p>
      ) : null}
      <Button disabled={!canCapture} onClick={onCapture}>
        Capture now
      </Button>
    </section>
  );
}

function Ready({
  proof,
  onCalibrate,
  onPreview,
  onBegin,
}: {
  proof: ProofRecord;
  onCalibrate: () => void;
  onPreview: () => void;
  onBegin: () => void;
}) {
  const mdc = proof.noiseFloor?.mdc;
  return (
    <section className="proof__section" aria-labelledby="ready-h">
      <h2 id="ready-h" className="mira-title">
        Your baseline is set
      </h2>
      <p>
        {mdc
          ? `A change smaller than ${mdc.toFixed(1)} points is within your day-to-day variation, so MIRA will not call it a change.`
          : "MIRA could not work out your day-to-day variation from these sessions. It will say so rather than guess."}
      </p>
      {!proof.phantom ? (
        <>
          <p>
            MIRA can also calibrate a visualisation for you: it simulates the concern at five
            strengths on one photo and checks that the measurement follows. This is optional.
          </p>
          <Button variant="secondary" disabled={!mdc} onClick={onCalibrate}>
            Calibrate the visualisation
          </Button>
        </>
      ) : proof.phantom.usable ? (
        <Button variant="secondary" onClick={onPreview}>
          Preview the smallest change MIRA can detect
        </Button>
      ) : (
        <p role="status">{PHANTOM_UNUSABLE}</p>
      )}
      <Button onClick={onBegin}>I have started using it</Button>
      <p className="mira-small">
        Press this on the day you start. The {String(proof.claim.windowDays)} days of the claim
        count from then.
      </p>
    </section>
  );
}

function VerdictCard({ proof, verdict }: { proof: ProofRecord; verdict: Verdict }) {
  const mdc = verdict.mdc;
  const band = mdc
    ? {
        floorStart: 0.25,
        floorEnd: 0.75,
        mark: Math.min(1, Math.max(0, 0.5 + verdict.delta / (4 * mdc))),
      }
    : undefined;
  return (
    <section className="proof__section" aria-labelledby="verdict-h" data-state={verdict.state}>
      <h2 id="verdict-h" className="mira-display-m">
        {verdictSentence(proof, verdict)}
      </h2>
      <Reading
        state={verdict.state === "collecting" ? "unavailable" : "value"}
        value={`${verdict.delta >= 0 ? "+" : "−"}${Math.abs(verdict.delta).toFixed(1)}`}
        unit="points"
        caption={`${concernSubject(proof.claim.concern)}: change from your baseline`}
        confidence={verdict.phrase}
        {...(band ? { band } : {})}
        {...(verdict.state === "collecting"
          ? { reason: "MIRA does not know your day-to-day variation yet." }
          : {})}
      />
      <dl className="proof__facts">
        <div>
          <dt>Your baseline</dt>
          <dd>{verdict.baseline.toFixed(1)}</dd>
        </div>
        <div>
          <dt>This check-in</dt>
          <dd>{verdict.now.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Smallest change MIRA can tell apart</dt>
          <dd>{mdc ? mdc.toFixed(1) : "not known yet"}</dd>
        </div>
      </dl>
    </section>
  );
}
