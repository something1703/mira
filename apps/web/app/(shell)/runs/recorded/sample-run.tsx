"use client";

import { Button, ErrorPanel, LabelStrip, Plate, buttonClass } from "@mira/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BuildCapture } from "../../../../src/capture/flow";
import { discardPhoto, uploadPhoto } from "../../../../src/capture/upload";
import { QuoteStep } from "../../capture/quote-step";

const SAMPLE = "/sample/sample-face.jpg";

type Stage =
  | { s: "intro" }
  | { s: "uploading" }
  | { s: "quote"; capture: BuildCapture }
  | { s: "error"; message: string };

/**
 * Uploads the drawn sample face through the same upload, quote and build steps a person's photo
 * takes, then hands over to the profile screen, which shows the run step by step.
 */
export function SampleRun() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ s: "intro" });

  const begin = async () => {
    setStage({ s: "uploading" });
    try {
      const blob = await (await fetch(SAMPLE)).blob();
      const up = await uploadPhoto(blob, "face");
      if (!up.ok) {
        setStage({ s: "error", message: "The sample photo could not be prepared." });
        return;
      }
      setStage({
        s: "quote",
        capture: {
          face: up.value.key,
          mode: up.value.hdCapable ? "hd" : "sd",
          source: "upload",
          qualityChecksPassed: null,
        },
      });
    } catch {
      setStage({ s: "error", message: "The sample photo could not be loaded." });
    }
  };

  const leave = (capture?: BuildCapture) => {
    if (capture) void discardPhoto(capture.face);
    router.push("/");
  };

  return (
    <div className="sample">
      <header className="capture__head">
        <h1 className="mira-display-l">A sample run</h1>
        <p className="lead">
          Watch MIRA measure a drawn sample face with the same steps a real photo goes through:
          upload, price, measure, then the profile. Every result is labelled as a sample, and
          nothing here is about you.
        </p>
      </header>

      <div className="sample-run">
        {/* The drawing is shown on the neutral mat, like every image in MIRA. */}
        <Plate
          src={SAMPLE}
          alt="A drawn sample face on the neutral mat, used for the sample run"
          state="ready"
          strip={
            <LabelStrip caption="Drawn sample face, not a real person" variant="visualisation" />
          }
        />

        <div>
          {stage.s === "intro" || stage.s === "uploading" ? (
            <div className="mira-row">
              <Button busy={stage.s === "uploading"} onClick={() => void begin()}>
                Start the sample run
              </Button>
              <Link href="/consent" className={buttonClass("quiet")}>
                Measure yourself instead
              </Link>
            </div>
          ) : null}

          {stage.s === "quote" ? (
            <QuoteStep
              capture={stage.capture}
              downgraded={false}
              onCancel={() => {
                leave(stage.capture);
              }}
              onBack={() => {
                void discardPhoto(stage.capture.face);
                setStage({ s: "intro" });
              }}
            />
          ) : null}

          {stage.s === "error" ? (
            <ErrorPanel
              title={stage.message}
              next="Try again, or measure yourself with a photo."
              actions={
                <>
                  <Button onClick={() => void begin()}>Try again</Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      router.push("/consent");
                    }}
                  >
                    Measure yourself
                  </Button>
                </>
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
