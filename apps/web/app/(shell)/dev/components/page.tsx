import {
  Banner,
  Button,
  EmptyState,
  ErrorPanel,
  Field,
  FidelityLabel,
  LabelStrip,
  Plate,
  QuoteSheet,
  Reading,
  Ring,
  StepRail,
  Swatch,
  SwatchList,
  Toast,
  ToastRegion,
  Verdict,
  type FidelityVariant,
  type Step,
} from "@mira/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DEMO_SHADES } from "../../../../demo/swatches";
import { GalleryInteractive } from "./interactive";

export const metadata: Metadata = { title: "Component gallery" };

const STEPS: Step[] = [
  { id: "1", label: "Lehenga tried on", state: "done" },
  { id: "2", label: "Garment colour checked", state: "cached" },
  { id: "3", label: "Makeup chosen for the outfit", state: "running" },
  { id: "4", label: "Hair colour", state: "queued" },
  { id: "5", label: "Venue", state: "failed", detail: "The venue image could not be made." },
  { id: "6", label: "Motion video", state: "skipped", detail: "Removed from the plan." },
];

const FIDELITY: FidelityVariant[] = [
  "verified",
  "drift",
  "not_checked",
  "recorded",
  "visualisation",
];

/**
 * Every component in every state, in one place, for review and for the accessibility scan. This is
 * the Phase 2 stand-in for a Storybook: one section per component, one example per state
 * (docs/DECISIONS.md D19). Development only.
 */
export default function ComponentGallery() {
  if (process.env.MIRA_MODE === "live") notFound();
  return (
    <div className="gallery">
      <h1 className="mira-display-l">Component gallery</h1>

      <section aria-labelledby="g-ring">
        <h2 id="g-ring" className="mira-display-m">
          Ring
        </h2>
        <div className="gallery__grid">
          <div>
            <h3>Idle</h3>
            <Ring
              mode="capture"
              label="The Ring at rest"
              checks={{ lighting: false, distance: false, angle: false, steadiness: false }}
            />
          </div>
          <div>
            <h3>Checking</h3>
            <Ring
              mode="capture"
              label="Capture checks: 2 of 4 passed"
              checks={{ lighting: true, distance: false, angle: true, steadiness: false }}
              instruction="Move a little closer"
            />
          </div>
          <div>
            <h3>Ready</h3>
            <Ring
              mode="capture"
              label="All four capture checks passed"
              checks={{ lighting: true, distance: true, angle: true, steadiness: true }}
            />
          </div>
          <div>
            <h3>Capturing</h3>
            <Ring
              mode="capture"
              label="Taking the photo"
              checks={{ lighting: true, distance: true, angle: true, steadiness: true }}
              capturing
              countdown={2}
            />
          </div>
          <div>
            <h3>Measuring</h3>
            <Ring mode="run" label="Building your sangeet look" steps={STEPS} />
          </div>
          <div>
            <h3>Done</h3>
            <Ring mode="reading" label="A reading on the scale" value={0.7} />
          </div>
          <div>
            <h3>Blocked</h3>
            <Ring
              mode="capture"
              label="Capture blocked"
              checks={{ lighting: false, distance: false, angle: false, steadiness: false }}
              blockedReason="Camera access is off. Turn it on in your browser settings, or upload a photo."
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="g-buttons">
        <h2 id="g-buttons" className="mira-display-m">
          Button
        </h2>
        <div className="mira-row">
          <Button>Start measuring</Button>
          <Button variant="secondary">See a recorded run</Button>
          <Button variant="quiet">Build a look with it</Button>
          <Button variant="critical">Delete my profile</Button>
          <Button busy>Matching your shade</Button>
          <Button disabled>Open the camera</Button>
        </div>
      </section>

      <section aria-labelledby="g-notices">
        <h2 id="g-notices" className="mira-display-m">
          Banner, toast, empty and error
        </h2>
        <div className="mira-notices" style={{ display: "grid", gap: "var(--mira-space-3)" }}>
          <Banner kind="recorded">
            You are viewing a recorded run. Results are real YouCam outputs captured earlier.
          </Banner>
          <Banner kind="offline">
            You are offline. Measurements will resume when you reconnect.
          </Banner>
          <Banner kind="budget" action={<Button variant="quiet">See what uses units</Button>}>
            Units left in this session: 12.
          </Banner>
          <ToastRegion>
            <Toast>Shade matched</Toast>
            <Toast kind="info">Background run finished.</Toast>
          </ToastRegion>
        </div>
        <EmptyState
          headingLevel={3}
          title="No looks yet."
          description="Pick an outfit to build your first one."
          action={<Button>Pick an outfit</Button>}
        />
        <ErrorPanel
          title="The photo is too dark to measure."
          why="No units were used."
          next="Face a window or a lamp and try again."
          traceId="trc_0123456789ab"
          actions={
            <>
              <Button>Retake</Button>
              <Button variant="secondary">Upload a photo instead</Button>
            </>
          }
        />
      </section>

      <section aria-labelledby="g-plates">
        <h2 id="g-plates" className="mira-display-m">
          Plate and label strip
        </h2>
        <div className="gallery__grid">
          <Plate
            state="loading"
            alt="Loading the unretouched preview"
            strip={
              <LabelStrip caption="Unretouched preview, smoothing off" variant="not_checked" />
            }
          />
          <Plate
            state="ready"
            alt="Placeholder for an unretouched preview"
            strip={
              <LabelStrip
                caption="Unretouched preview, smoothing off"
                variant="verified"
                detail="lip colour within ΔE 2.4 of the product"
                recorded
              />
            }
          />
          <Plate
            state="drift"
            alt="Placeholder for a look preview with drifted colour"
            strip={
              <LabelStrip
                caption="Look preview"
                variant="drift"
                detail="the garment reads lighter than the product photo"
              />
            }
          />
          <Plate
            state="withheld"
            alt="A withheld preview"
            strip={<LabelStrip caption="Look preview" variant="not_checked" />}
          />
          <Plate
            state="expired"
            alt="An expired image"
            strip={<LabelStrip caption="Saved preview" variant="not_checked" />}
          />
        </div>
        <h3>Fidelity labels</h3>
        <div className="mira-row">
          {FIDELITY.map((v) => (
            <FidelityLabel key={v} variant={v} />
          ))}
        </div>
      </section>

      <section aria-labelledby="g-readings">
        <h2 id="g-readings" className="mira-display-m">
          Reading and swatch
        </h2>
        <div className="gallery__grid">
          <Reading
            caption="Blend"
            value="1.8"
            unit="ΔE2000 from your skin"
            confidence="blends closely"
          />
          <Reading
            state="below_floor"
            caption="Visible pores"
            value="62"
            unit="raw score"
            confidence="within your day-to-day variation"
            band={{ floorStart: 0.38, floorEnd: 0.56, mark: 0.45 }}
          />
          <Reading
            caption="Visible pores"
            value="71"
            unit="raw score"
            confidence="a clear change above your day-to-day variation"
            band={{ floorStart: 0.38, floorEnd: 0.56, mark: 0.78 }}
          />
          <Reading
            state="unavailable"
            caption="Hair density"
            reason="The photo was too dark to measure."
            action={<Button variant="quiet">Retry hair</Button>}
          />
        </div>
        <p className="mira-body-l mira-figures">
          <span id="tab-a">1111.00</span> <span id="tab-b">0000.11</span>
        </p>
        <SwatchList label="Rendered shades">
          {DEMO_SHADES.map((shade) => (
            <Swatch key={shade.name} {...shade} />
          ))}
        </SwatchList>
      </section>

      <section aria-labelledby="g-runs">
        <h2 id="g-runs" className="mira-display-m">
          Step rail, quote sheet and verdict
        </h2>
        <div className="gallery__grid">
          <div className="mira-panel">
            <StepRail label="Building your sangeet look" steps={STEPS} />
          </div>
          <QuoteSheet
            state="ready"
            title="Build this look?"
            lines={[
              { label: "Clothes and accessories", units: 10 },
              { label: "Makeup and hair", units: 8 },
              { label: "Motion video", units: 24 },
            ]}
            confirmLabel="Build this look"
            extraActions={<Button variant="quiet">Remove video</Button>}
          />
          <QuoteSheet state="quoting" title="Build this look?" />
          <QuoteSheet
            state="over_cap"
            title="Build this look?"
            lines={[
              { label: "Clothes and accessories", units: 10 },
              { label: "Motion video", units: 24 },
            ]}
            unitsLeft={20}
            confirmLabel="Build this look"
            extraActions={<Button variant="quiet">Use a recorded run</Button>}
          />
          <QuoteSheet
            state="confirmed"
            title="Build this look?"
            lines={[{ label: "Clothes and accessories", units: 10 }]}
            confirmLabel="Build this look"
          />
        </div>
        <Verdict
          state="detected"
          sentence="Visible pores changed more than your day-to-day variation."
        >
          <Reading
            caption="Visible pores"
            value="71"
            unit="raw score"
            confidence="a clear change above your day-to-day variation"
            band={{ floorStart: 0.38, floorEnd: 0.56, mark: 0.78 }}
          />
        </Verdict>
        <Verdict
          state="not_yet"
          sentence="No change we can tell apart from your day-to-day variation yet. You are on day 12 of a 28-day claim."
        />
        <Verdict
          state="unavailable"
          sentence="MIRA cannot visualise changes for this concern reliably, so it will report numbers only."
        />
      </section>

      <section aria-labelledby="g-inputs">
        <h2 id="g-inputs" className="mira-display-m">
          Field, toggle, dialog and tabs
        </h2>
        <div className="gallery__grid">
          <Field label="Product link" hint="Paste a shade-finder page." />
          <Field
            label="Product link"
            error="Enter a link that starts with https."
            defaultValue="shade"
          />
          <Field type="checkbox" label="I understand and want to continue" />
        </div>
        <GalleryInteractive />
      </section>
    </div>
  );
}
