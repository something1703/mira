import { FidelityLabel, type FidelityVariant } from "./FidelityLabel";

export interface LabelStripProps {
  /** What the image is, e.g. "Unretouched preview, smoothing off". */
  caption: string;
  variant: FidelityVariant;
  detail?: string;
  /** Adds a "Recorded run" label beside the fidelity label. */
  recorded?: boolean;
}

/** The strip under every plate: what it is and how it was verified (DESIGN_SYSTEM.md §1.3). */
export function LabelStrip({ caption, variant, detail, recorded = false }: LabelStripProps) {
  return (
    <div className="mira-strip">
      <span className="mira-strip__caption">{caption}</span>
      <span className="mira-strip__labels">
        <FidelityLabel variant={variant} {...(detail ? { detail } : {})} />
        {recorded && variant !== "recorded" ? <FidelityLabel variant="recorded" /> : null}
      </span>
    </div>
  );
}
