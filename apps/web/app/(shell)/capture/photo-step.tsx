"use client";

import { Banner, Button, Ring } from "@mira/ui";
import { useEffect, useId, useRef, useState } from "react";
import type { FaceDetectionMode } from "../../../src/camera-kit/types";
import { CAMERA_COPY, UPLOAD_MESSAGES } from "../../../src/capture/copy";
import type { Photo } from "../../../src/capture/flow";
import { discardPhoto, uploadPhoto, type UploadKind } from "../../../src/capture/upload";
import { CameraStage, type CameraProblem, type CapturedPhoto } from "./camera-stage";
import { PlainStage } from "./plain-stage";

type View =
  | { v: "start" }
  | { v: "camera"; run: number }
  | { v: "problem"; problem: CameraProblem }
  | { v: "picker"; message?: string }
  | { v: "uploading"; progress: number; preview: string }
  | { v: "review"; photos: Photo[]; preview: string }
  | { v: "failed"; message: string };

export interface PhotoStepProps {
  /** Names the Ring for screen readers, e.g. "Face photo". */
  label: string;
  engine: "camerakit" | "plain";
  mode?: FaceDetectionMode;
  /** One kind per photo the step returns, in order; hair returns front, right and left. */
  kinds: readonly UploadKind[];
  hd: boolean;
  /** The person chose to continue in standard detail after a low-resolution camera. */
  onStandardDetail: () => void;
  /** Show "Use this photo" before moving on. Repeat captures do not: they are seconds apart. */
  review: boolean;
  /** Go straight to the camera. Used after the first photo, when the camera is already allowed. */
  autoStart: boolean;
  onAccept: (photos: Photo[]) => void;
  onSkip?: () => void;
}

const ANGLES = ["front", "right", "left"] as const;

/** Orders a multi-photo capture as front, right, left from the SDK's phase names, else as given. */
function ordered(photos: CapturedPhoto[], count: number): CapturedPhoto[] {
  if (count === 1) return photos.slice(0, 1);
  return ANGLES.slice(0, count)
    .map((angle, i) => photos.find((p) => p.phase?.toLowerCase().includes(angle)) ?? photos[i])
    .filter((p): p is CapturedPhoto => p !== undefined);
}

/**
 * One photo from start to accepted: permission, live checks, capture, upload with its server-side
 * checks, then review. Every failure has words and a way on, and "Upload a photo instead" is always
 * one press away (docs/UX_FLOWS.md §3).
 */
export function PhotoStep(props: PhotoStepProps) {
  const { label, engine, mode, kinds, hd, review, onSkip } = props;
  const [view, setView] = useState<View>(
    props.autoStart ? { v: "camera", run: 0 } : { v: "start" },
  );
  const [howOpen, setHowOpen] = useState(false);
  // Camera Kit could not open (or the person chose to skip it): use the browser's own camera.
  const [simple, setSimple] = useState(false);
  const runs = useRef(1);
  const previewUrl = useRef<string | undefined>(undefined);
  const heldKeys = useRef<string[]>([]);
  const accept = useRef(props.onAccept);
  useEffect(() => {
    accept.current = props.onAccept;
  });
  const hint = useId();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      // Leaving this step (Cancel, Back, a new step) with a photo that was never accepted: it goes.
      for (const key of heldKeys.current) void discardPhoto(key);
      heldKeys.current = [];
    };
  }, []);

  /** Hands the photos to the flow, which owns them from here (and discards them if replaced). */
  const hand = (photos: Photo[]) => {
    heldKeys.current = [];
    accept.current(photos);
  };

  const toCamera = () => {
    runs.current += 1;
    setView({ v: "camera", run: runs.current });
  };

  const toSimpleCamera = () => {
    setSimple(true);
    toCamera();
  };

  /** Uploads what was captured or chosen, then reviews it (or accepts it straight away). */
  const send = async (blobs: { blob: Blob; source: Photo["source"] }[]) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    const first = blobs[0];
    if (!first) return;
    const preview = URL.createObjectURL(first.blob);
    previewUrl.current = preview;
    setView({ v: "uploading", progress: 0, preview });
    const done: Photo[] = [];
    for (const [i, item] of blobs.entries()) {
      const kind = kinds[i];
      if (!kind) break;
      const out = await uploadPhoto(item.blob, kind, (share) => {
        setView({ v: "uploading", progress: (i + share) / blobs.length, preview });
      });
      if (!out.ok) {
        for (const p of done) void discardPhoto(p.key);
        heldKeys.current = [];
        if (mounted.current) setView({ v: "failed", message: UPLOAD_MESSAGES[out.code] });
        return;
      }
      done.push({ ...out.value, source: item.source });
      heldKeys.current = done.map((p) => p.key);
    }
    if (!mounted.current) {
      // The person left while the photo was uploading.
      for (const p of done) void discardPhoto(p.key);
      heldKeys.current = [];
      return;
    }
    if (review) setView({ v: "review", photos: done, preview });
    else hand(done);
  };

  const fromCamera = (shots: CapturedPhoto[]) => {
    // "camera" means the Ring's live checks passed. The simple camera has none, so its photos are
    // treated like uploads: unguided, checked by YouCam alone, with the upload angle tolerance.
    const source: Photo["source"] = simple && engine === "camerakit" ? "upload" : "camera";
    void send(ordered(shots, kinds.length).map((s) => ({ blob: s.blob, source })));
  };

  const picker = (message?: string) => {
    setView({ v: "picker", ...(message === undefined ? {} : { message }) });
  };

  const skip = onSkip ? (
    <Button variant="quiet" onClick={onSkip}>
      Skip this step
    </Button>
  ) : null;

  if (view.v === "start") {
    return (
      <div className="capture__panel">
        <p>{CAMERA_COPY.permission}</p>
        <div className="mira-row">
          <Button onClick={toCamera}>Allow camera</Button>
          <Button
            variant="secondary"
            onClick={() => {
              picker();
            }}
          >
            Upload a photo instead
          </Button>
          {skip}
        </div>
      </div>
    );
  }

  if (view.v === "camera") {
    return (
      <div className="capture__panel">
        {engine === "camerakit" && mode && !simple ? (
          <CameraStage
            key={`${String(view.run)}-${String(hd)}`}
            mode={mode}
            hd={hd}
            label={label}
            onCaptured={fromCamera}
            onProblem={(problem) => {
              setView({ v: "problem", problem });
            }}
          />
        ) : (
          <PlainStage
            key={view.run}
            label={label}
            onCaptured={fromCamera}
            onProblem={(problem) => {
              setView({ v: "problem", problem });
            }}
          />
        )}
        <div className="mira-row">
          <Button
            variant="secondary"
            onClick={() => {
              picker();
            }}
          >
            Upload a photo instead
          </Button>
          {engine === "camerakit" && !simple ? (
            <Button variant="quiet" onClick={toSimpleCamera}>
              Camera not starting? Use the simple camera
            </Button>
          ) : null}
          {skip}
        </div>
      </div>
    );
  }

  if (view.v === "problem") {
    const p = view.problem;
    return (
      <div className="capture__panel">
        <Ring
          mode="capture"
          label={`${label}. The camera is not available`}
          checks={{ lighting: false, distance: false, angle: false, steadiness: false }}
          blockedReason={p === "lowres" ? "Low camera resolution" : "Camera not available"}
        />
        <p role="status">
          {p === "denied"
            ? CAMERA_COPY.denied
            : p === "unsupported"
              ? CAMERA_COPY.unsupported
              : p === "lowres"
                ? CAMERA_COPY.lowRes
                : p === "blocked"
                  ? CAMERA_COPY.blocked
                  : CAMERA_COPY.failed}
        </p>
        {engine === "camerakit" && !simple && (p === "failed" || p === "blocked") ? (
          <p className="mira-small mira-muted">{CAMERA_COPY.simple}</p>
        ) : null}
        {p === "denied" ? (
          <>
            <Button
              variant="quiet"
              aria-expanded={howOpen}
              aria-controls={hint}
              onClick={() => {
                setHowOpen(!howOpen);
              }}
            >
              How to turn it on
            </Button>
            {howOpen ? <p id={hint}>{CAMERA_COPY.deniedHow}</p> : null}
          </>
        ) : null}
        <div className="mira-row">
          {p === "lowres" ? (
            <Button
              onClick={() => {
                props.onStandardDetail();
                toCamera();
              }}
            >
              Continue in standard
            </Button>
          ) : null}
          {p !== "unsupported" && p !== "lowres" ? (
            <Button onClick={toCamera}>Try the camera again</Button>
          ) : null}
          {engine === "camerakit" &&
          !simple &&
          (p === "failed" || p === "blocked" || p === "lowres") ? (
            <Button variant="secondary" onClick={toSimpleCamera}>
              Use the simple camera
            </Button>
          ) : null}
          <Button
            variant={p === "unsupported" || p === "lowres" ? "primary" : "secondary"}
            onClick={() => {
              picker();
            }}
          >
            {p === "lowres" ? "Upload a sharper photo" : "Upload a photo instead"}
          </Button>
          {skip}
        </div>
      </div>
    );
  }

  if (view.v === "picker") {
    return (
      <div className="capture__panel">
        {view.message ? <Banner kind="info">{view.message}</Banner> : null}
        <Picker
          kinds={kinds}
          onChosen={(files) => {
            void send(files.map((blob) => ({ blob, source: "upload" as const })));
          }}
        />
        <div className="mira-row">
          <Button variant="secondary" onClick={toCamera}>
            Use the camera instead
          </Button>
          {skip}
        </div>
      </div>
    );
  }

  if (view.v === "uploading") {
    return (
      <div className="capture__panel">
        <Ring mode="reading" progress value={view.progress} label={`${label}. Uploading securely`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote image */}
          <img className="capture__preview" src={view.preview} alt="" />
        </Ring>
        <p role="status">Uploading securely</p>
      </div>
    );
  }

  if (view.v === "review") {
    const fromUpload = view.photos.some((p) => p.source === "upload");
    return (
      <div className="capture__panel">
        {/* A photo under review is finished, so the Ring shows it at rest, not as a live check. */}
        <Ring
          mode="reading"
          value={1}
          label={`${label}. ${fromUpload ? "Photo chosen" : "Photo taken"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote image */}
          <img
            className="capture__preview"
            src={view.preview}
            alt={fromUpload ? "The photo you chose" : "The photo you just took"}
          />
        </Ring>
        <p className="mira-small mira-muted">
          Check that your whole face is in the photo and evenly lit.
        </p>
        <div className="mira-row">
          <Button
            onClick={() => {
              hand(view.photos);
            }}
          >
            Use this photo
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              for (const p of view.photos) void discardPhoto(p.key);
              heldKeys.current = [];
              toCamera();
            }}
          >
            Retake
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="capture__panel">
      <Banner kind="info">{view.message}</Banner>
      <div className="mira-row">
        <Button onClick={toCamera}>Try the camera again</Button>
        <Button
          variant="secondary"
          onClick={() => {
            picker();
          }}
        >
          Choose another photo
        </Button>
        {skip}
      </div>
    </div>
  );
}

const ANGLE_LABELS: Record<UploadKind, string> = {
  face: "Face photo",
  repeat: "Repeat photo",
  body: "Full-body photo",
  hand: "Hand photo",
  hair_front: "Hair, from the front",
  hair_right: "Hair, from the right",
  hair_left: "Hair, from the left",
  garment: "Garment photo",
};

/** File choosers: one for most steps, front/right/left for hair (front is enough on its own). */
function Picker({
  kinds,
  onChosen,
}: {
  kinds: readonly UploadKind[];
  onChosen: (files: Blob[]) => void;
}) {
  const [chosen, setChosen] = useState<(File | undefined)[]>([]);
  const multi = kinds.length > 1;
  return (
    <div className="capture__picker">
      {kinds.map((kind, i) => (
        <label key={kind} className="capture__file">
          <span>
            {ANGLE_LABELS[kind]}
            {multi && i > 0 ? " (optional, right and left together)" : ""}
          </span>
          <input
            className="capture__input"
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!multi) {
                if (file) onChosen([file]);
                return;
              }
              const next = [...chosen];
              next[i] = file;
              setChosen(next);
            }}
          />
        </label>
      ))}
      <p className="mira-small mira-muted">A JPEG or PNG photo, taken in even light.</p>
      {multi && chosen[0] && Boolean(chosen[1]) !== Boolean(chosen[2]) ? (
        <p role="status" className="mira-small">
          Add the other side too, or MIRA will use the front photo only.
        </p>
      ) : null}
      {multi ? (
        <Button
          disabled={!chosen[0]}
          onClick={() => {
            // Front is required; a side photo counts only if the other side came with it.
            const [front, right, left] = chosen;
            const files = front && right && left ? [front, right, left] : front ? [front] : [];
            onChosen(files);
          }}
        >
          Use these photos
        </Button>
      ) : null}
    </div>
  );
}
