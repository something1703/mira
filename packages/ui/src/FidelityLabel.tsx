import type { ComponentType } from "react";
import { cx } from "./cx";
import { CheckIcon, DriftIcon, NotCheckedIcon, RecordedIcon, VisualisationIcon } from "./icons";

export type FidelityVariant = "verified" | "drift" | "not_checked" | "recorded" | "visualisation";

const WORDS: Record<FidelityVariant, string> = {
  verified: "Verified",
  drift: "Colour drifted",
  not_checked: "Not checked",
  recorded: "Recorded run",
  visualisation: "Visualisation",
};

const ICONS: Record<FidelityVariant, ComponentType> = {
  verified: CheckIcon,
  drift: DriftIcon,
  not_checked: NotCheckedIcon,
  recorded: RecordedIcon,
  visualisation: VisualisationIcon,
};

export interface FidelityLabelProps {
  variant: FidelityVariant;
  /** Overrides the default word, e.g. "Lip colour verified". */
  word?: string;
  /** The evidence, e.g. "lip colour within ΔE 2.4 of the product". */
  detail?: string;
}

/** Status is never colour alone: every label pairs colour with an icon and a word. */
export function FidelityLabel({ variant, word, detail }: FidelityLabelProps) {
  const Icon = ICONS[variant];
  return (
    <span className="mira-fidelity">
      <span className={cx("mira-label", `mira-label--${variant}`)}>
        <Icon />
        {word ?? WORDS[variant]}
      </span>
      {detail ? <span className="mira-fidelity__detail">{detail}</span> : null}
    </span>
  );
}
