"use client";

import { Button, StepRail, type Step } from "@mira/ui";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import { STEP_GUIDE, STEP_RAIL_LABELS, STEP_TITLES, STEP_WHY } from "../../../src/capture/copy";
import {
  OPTIONAL,
  downgraded,
  heldKeys,
  initialState,
  isDone,
  reduce,
  stepComplete,
  stepOf,
  toCapture,
  type HairAngle,
  type Photo,
  type Plan,
  type StepId,
} from "../../../src/capture/flow";
import { discardPhoto } from "../../../src/capture/upload";
import { PhotoStep } from "./photo-step";
import { QuoteStep } from "./quote-step";

const HAIR: readonly HairAngle[] = ["front", "right", "left"];

/** Capture (docs/UX_FLOWS.md §3): the steps in order, then the price, then the build. */
export function CaptureFlow({ plan }: { plan: Plan }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, plan, initialState);
  const [hd, setHd] = useState(true);
  const [pause, setPause] = useState(false);
  const held = useRef<string[]>([]);
  useEffect(() => {
    held.current = heldKeys(state);
  });

  const step = stepOf(state);
  const rail: Step[] = plan.steps.map((id, i) => ({
    id,
    label: STEP_RAIL_LABELS[id],
    state: state.skipped.includes(id)
      ? "skipped"
      : stepComplete(state, id)
        ? "done"
        : i === state.index
          ? "running"
          : "queued",
  }));

  const leave = () => {
    for (const key of held.current) void discardPhoto(key);
    router.push("/");
  };

  if (isDone(state)) {
    const capture = toCapture(state);
    if (!capture) {
      return (
        <div className="capture">
          <p role="alert">There is no photo to measure yet.</p>
          <Button
            onClick={() => {
              dispatch({ t: "retake", step: plan.steps[0] ?? "face" });
            }}
          >
            Take a photo
          </Button>
        </div>
      );
    }
    return (
      <div className="capture">
        <StepRail label="Capture steps" steps={rail} />
        <QuoteStep
          capture={capture}
          downgraded={downgraded(state)}
          onCancel={leave}
          onBack={() => {
            dispatch({ t: "back" });
          }}
        />
      </div>
    );
  }
  if (!step) return null;

  const onAccept = (photos: Photo[]) => {
    const [first] = photos;
    if (!first) return;
    switch (step) {
      case "face":
        dispatch({ t: "face", photo: first });
        return;
      case "repeats":
        dispatch({ t: "repeat", photo: first });
        // A few seconds between the photos, so the readings are independent captures of one session.
        if (state.repeats.length + 1 < 2) {
          setPause(true);
          setTimeout(() => {
            setPause(false);
          }, 2500);
        }
        return;
      case "body":
        dispatch({ t: "body", photo: first });
        return;
      case "hand":
        dispatch({ t: "hand", photo: first });
        return;
      case "hair":
        dispatch({
          t: "hair",
          photos: Object.fromEntries(photos.slice(0, 3).map((p, i) => [HAIR[i] ?? "front", p])),
        });
        return;
    }
  };

  const config: Record<
    StepId,
    Pick<React.ComponentProps<typeof PhotoStep>, "engine" | "mode" | "kinds" | "review">
  > = {
    face: {
      engine: "camerakit",
      mode: hd ? "hdskincare" : "comprehensive",
      kinds: ["face"],
      review: true,
    },
    repeats: {
      engine: "camerakit",
      mode: hd ? "hdskincare" : "comprehensive",
      kinds: ["repeat"],
      review: false,
    },
    body: { engine: "plain", kinds: ["body"], review: true },
    hand: { engine: "plain", kinds: ["hand"], review: true },
    hair: {
      engine: "camerakit",
      mode: "hairtype",
      kinds: ["hair_front", "hair_right", "hair_left"],
      review: true,
    },
  };

  return (
    <div className="capture">
      <StepRail label="Capture steps" steps={rail} />
      <header className="capture__head">
        <h1 className="mira-display-l">
          {step === "repeats"
            ? `${STEP_TITLES.repeats}: ${String(state.repeats.length + 1)} of 2`
            : STEP_TITLES[step]}
        </h1>
        <p className="lead">{STEP_GUIDE[step]}</p>
        {STEP_WHY[step] ? <p className="mira-small mira-muted">{STEP_WHY[step]}</p> : null}
      </header>
      {pause ? (
        <p role="status" className="capture__panel">
          Stay where you are. The next photo is coming.
        </p>
      ) : (
        <PhotoStep
          // A new photo, or a new step, starts the step afresh.
          key={`${step}-${String(state.repeats.length)}-${String(state.index)}`}
          label={STEP_RAIL_LABELS[step]}
          {...config[step]}
          hd={hd}
          onStandardDetail={() => {
            setHd(false);
          }}
          autoStart={step === "repeats" && state.face?.source === "camera"}
          onAccept={onAccept}
          {...(OPTIONAL.has(step)
            ? {
                onSkip: () => {
                  dispatch({ t: "skip" });
                },
              }
            : {})}
        />
      )}
      <div className="mira-row">
        {state.index > 0 ? (
          <Button
            variant="quiet"
            onClick={() => {
              dispatch({ t: "back" });
            }}
          >
            Back
          </Button>
        ) : null}
        <Button variant="quiet" onClick={leave}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
