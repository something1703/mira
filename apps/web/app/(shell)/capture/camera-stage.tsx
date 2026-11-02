"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  NO_CHECKS,
  SteadyTracker,
  COUNTING_MS,
  qualityChecks,
  ringView,
  type RingView,
} from "../../../src/camera-kit/bridge";
import { meetsHdSkincare, probeCamera } from "../../../src/camera-kit/capability";
import { cameraSupported, loadCameraKit } from "../../../src/camera-kit/loader";
import {
  Captured,
  FaceQuality,
  MOUNT_ID,
  cameraFailure,
  imageToBlob,
  type FaceDetectionMode,
  type YmkApi,
} from "../../../src/camera-kit/types";

export type CameraProblem = "denied" | "lowres" | "failed" | "unsupported" | "blocked";

export interface CapturedPhoto {
  phase: string | undefined;
  blob: Blob;
  width: number;
  height: number;
}

export interface CameraStageProps {
  mode: FaceDetectionMode;
  /** Ask the camera for 1080p or better (applies to `hdskincare` only). */
  hd: boolean;
  label: string;
  onCaptured: (photos: CapturedPhoto[]) => void;
  onProblem: (problem: CameraProblem) => void;
  /** The step's actions (upload instead, skip), shown beside the camera. */
  children?: ReactNode;
}

/** The four checks in plain words, in the order Camera Kit prompts for them. */
const CHECKS = [
  ["lighting", "Even lighting"],
  ["angle", "Facing the camera"],
  ["distance", "Right distance"],
  ["steadiness", "Holding still"],
] as const;

/**
 * YouCam's Camera Kit inside the Ring (docs/UX_FLOWS.md §3). The SDK draws the live view into
 * `#YMK-module`; MIRA turns its `faceQualityChanged` events into the Ring's four ticks and one
 * instruction line, and hands back the photo when the SDK takes it.
 */
export function CameraStage({
  mode,
  hd,
  label,
  onCaptured,
  onProblem,
  children,
}: CameraStageProps) {
  const [view, setView] = useState<RingView>({ checks: NO_CHECKS, capturing: false });
  const [starting, setStarting] = useState(true);
  // The callbacks change on every render of the parent; the SDK session must not restart for that.
  const handlers = useRef({ onCaptured, onProblem });
  useEffect(() => {
    handlers.current = { onCaptured, onProblem };
  });

  useEffect(() => {
    const life = { alive: true };
    const steady = new SteadyTracker();
    let ymk: YmkApi | undefined;
    let lastQuality: FaceQuality | undefined;
    const listeners: [string, (payload: unknown) => void][] = [];

    const show = (q: FaceQuality) => {
      const base = qualityChecks(q);
      const all = base.lighting && base.distance && base.angle;
      setView(ringView(q, steady.update(all, Date.now())));
    };
    const on = (name: string, fn: (payload: unknown) => void) => {
      listeners.push([name, fn]);
      ymk?.addEventListener(name, fn);
    };

    void (async () => {
      // HD needs a camera Camera Kit will accept; check first so a lesser camera gets MIRA's own
      // "standard detail" choice instead of the SDK's refusal inside the Ring.
      if (!cameraSupported()) {
        handlers.current.onProblem("unsupported");
        return;
      }
      if (mode === "hdskincare" && hd) {
        const probe = await probeCamera();
        if (!life.alive) return;
        if (!probe.ok) {
          handlers.current.onProblem(probe.reason === "denied" ? "denied" : "failed");
          return;
        }
        if (!meetsHdSkincare(probe)) {
          handlers.current.onProblem("lowres");
          return;
        }
      }
      const sdk = await loadCameraKit();
      if (!life.alive) return;
      if (!sdk.ok) {
        handlers.current.onProblem(sdk.reason === "unsupported" ? "unsupported" : "blocked");
        return;
      }
      ymk = sdk.ymk;
      on("faceQualityChanged", (payload) => {
        const q = FaceQuality.safeParse(payload);
        if (!q.success || !life.alive) return;
        lastQuality = q.data;
        show(q.data);
      });
      on("loaded", () => {
        if (life.alive) setStarting(false);
      });
      on("opened", () => {
        if (life.alive) setStarting(false);
      });
      on("cameraFailed", (payload) => {
        if (!life.alive) return;
        const f = cameraFailure(payload);
        handlers.current.onProblem(
          f === "permission_denied"
            ? "denied"
            : f === "resolution_unsupported"
              ? "lowres"
              : "failed",
        );
      });
      on("unsupportedResolution", () => {
        if (life.alive) handlers.current.onProblem("lowres");
      });
      on("unsupportedWebcamResolution", () => {
        if (life.alive) handlers.current.onProblem("lowres");
      });
      on("faceDetectionCaptured", (payload) => {
        const c = Captured.safeParse(payload);
        if (!c.success || !life.alive) return;
        const photos: CapturedPhoto[] = [];
        for (const img of c.data.images) {
          const blob = imageToBlob(img.image);
          if (blob) photos.push({ phase: img.phase, blob, width: img.width, height: img.height });
        }
        if (photos.length === 0) handlers.current.onProblem("failed");
        else handlers.current.onCaptured(photos);
      });
      // Draw the view at the size of its frame (4:3), within the SDK's 300–1920 px limits.
      const frame = document.getElementById(MOUNT_ID)?.clientWidth ?? 640;
      const width = Math.min(1920, Math.max(300, Math.round(frame)));
      ymk.init({
        faceDetectionMode: mode,
        width,
        height: Math.min(1920, Math.max(300, Math.round((width * 3) / 4))),
        imageFormat: "blob",
        qualityLevel: "moderate",
        ...(mode === "hdskincare" && hd ? { videoQuality: "1080p" as const } : {}),
        countingDuration: COUNTING_MS,
        language: "en",
      });
      ymk.openCameraKit();
    })();

    // The countdown moves between SDK events, which can be seconds apart.
    const tick = setInterval(() => {
      if (lastQuality) show(lastQuality);
    }, 250);

    return () => {
      life.alive = false;
      clearInterval(tick);
      for (const [name, fn] of listeners) ymk?.removeEventListener(name, fn);
      try {
        ymk?.close();
      } catch {
        // The SDK was never opened, or is already closed.
      }
    };
  }, [mode, hd]);

  const passed = Object.values(view.checks).filter(Boolean).length;
  // Camera Kit draws a rectangular view with its own prompts, so it gets a rectangle, not the
  // Ring's circle (which clipped them). MIRA's own checks sit beside it, in words.
  const status = view.capturing
    ? view.countdown !== undefined
      ? `Hold still. Taking the photo in ${String(view.countdown)}`
      : "Hold still"
    : starting
      ? "Opening the camera"
      : (view.instruction ?? "Looking for your face");
  return (
    <div
      className="camera"
      data-state={view.capturing ? "capturing" : starting ? "starting" : "checking"}
    >
      <div className="camera__view">
        <div id={MOUNT_ID} className="camera__mount" />
        {starting ? (
          <p className="camera__starting" aria-hidden="true">
            Opening the camera
          </p>
        ) : null}
      </div>
      <div className="camera__side">
        <p className="camera__status" role="status" aria-live="polite">
          {status}
        </p>
        <div role="group" aria-label={`${label}. Capture checks: ${String(passed)} of 4 passed`}>
          <ul className="camera__checks">
            {CHECKS.map(([key, words]) => (
              <li key={key} className={view.checks[key] ? "is-ok" : undefined}>
                <span className="camera__mark" aria-hidden="true" />
                <span>{words}</span>
                <span className="camera__word">{view.checks[key] ? "Good" : "Not yet"}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mira-small mira-muted">
          The photo is taken by itself once every check holds. Nothing is recorded before that.
        </p>
        {children}
      </div>
    </div>
  );
}
