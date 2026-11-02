"use client";

import { Button, Ring } from "@mira/ui";
import { useEffect, useRef, useState } from "react";
import { cameraSupported } from "../../../src/camera-kit/loader";
import type { CameraProblem, CapturedPhoto } from "./camera-stage";

const TIMER_SECONDS = 5;

/**
 * A plain camera for the full-body and hand photos, which Camera Kit does not guide. A timer gives
 * the person time to step back; there is no face check, so the Ring stays at rest.
 */
export function PlainStage({
  label,
  onCaptured,
  onProblem,
}: {
  label: string;
  onCaptured: (photos: CapturedPhoto[]) => void;
  onProblem: (problem: CameraProblem) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [seconds, setSeconds] = useState<number | undefined>();
  const handlers = useRef({ onCaptured, onProblem });
  useEffect(() => {
    handlers.current = { onCaptured, onProblem };
  });

  useEffect(() => {
    const life = { alive: true };
    if (!cameraSupported()) {
      handlers.current.onProblem("unsupported");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1440 } },
      })
      .then((s) => {
        if (!life.alive) {
          s.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => {
            if (life.alive) setReady(true);
          });
        }
      })
      .catch((error: unknown) => {
        if (!life.alive) return;
        const name = error instanceof DOMException ? error.name : "";
        handlers.current.onProblem(name === "NotAllowedError" ? "denied" : "failed");
      });
    return () => {
      life.alive = false;
      stream.current?.getTracks().forEach((t) => {
        t.stop();
      });
      stream.current = null;
    };
  }, []);

  useEffect(() => {
    if (seconds === undefined) return;
    if (seconds === 0) {
      const el = video.current;
      if (!el || el.videoWidth === 0) {
        setSeconds(undefined);
        handlers.current.onProblem("failed");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      canvas.getContext("2d")?.drawImage(el, 0, 0);
      canvas.toBlob(
        (blob) => {
          setSeconds(undefined);
          if (blob) {
            handlers.current.onCaptured([
              { phase: undefined, blob, width: canvas.width, height: canvas.height },
            ]);
          } else handlers.current.onProblem("failed");
        },
        "image/jpeg",
        0.92,
      );
      return;
    }
    const t = setTimeout(() => {
      setSeconds(seconds - 1);
    }, 1000);
    return () => {
      clearTimeout(t);
    };
  }, [seconds]);

  return (
    <div className="capture__plain">
      <Ring
        mode="capture"
        label={label}
        checks={{ lighting: false, distance: false, angle: false, steadiness: false }}
      >
        <video ref={video} className="capture__video" muted playsInline aria-label="Camera view" />
      </Ring>
      <div className="mira-row">
        <Button
          disabled={!ready || seconds !== undefined}
          onClick={() => {
            setSeconds(TIMER_SECONDS);
          }}
        >
          {seconds === undefined
            ? `Take photo in ${String(TIMER_SECONDS)} seconds`
            : `Taking photo in ${String(seconds)}`}
        </Button>
        {seconds !== undefined ? (
          <Button
            variant="secondary"
            onClick={() => {
              setSeconds(undefined);
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
