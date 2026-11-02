"use client";

import { Ring } from "@mira/ui";
import { useEffect, useRef, useState } from "react";
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
}

/**
 * YouCam's Camera Kit inside the Ring (docs/UX_FLOWS.md §3). The SDK draws the live view into
 * `#YMK-module`; MIRA turns its `faceQualityChanged` events into the Ring's four ticks and one
 * instruction line, and hands back the photo when the SDK takes it.
 */
export function CameraStage({ mode, hd, label, onCaptured, onProblem }: CameraStageProps) {
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
      ymk.init({
        faceDetectionMode: mode,
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
  return (
    <Ring
      mode="capture"
      label={`${label}. Capture checks: ${String(passed)} of 4 passed`}
      checks={view.checks}
      capturing={view.capturing}
      {...(view.instruction ? { instruction: view.instruction } : {})}
      {...(view.countdown === undefined ? {} : { countdown: view.countdown })}
    >
      <div id={MOUNT_ID} className="capture__mount" />
      {starting ? (
        <p className="capture__starting" role="status">
          Opening the camera
        </p>
      ) : null}
    </Ring>
  );
}
