import type { ReactNode } from "react";
import { cx } from "./cx";

export type VerdictState = "detected" | "not_yet" | "unavailable";

export interface VerdictProps {
  state: VerdictState;
  /** One sentence (docs/COPY.md §2, Verdicts), then evidence. */
  sentence: string;
  /** The evidence: a Reading, timeline chart, visualisation plate. */
  children?: ReactNode;
}

/** Proof outcome in Gloock, then its evidence. Never coloured red or green. */
export function Verdict({ state, sentence, children }: VerdictProps) {
  return (
    <section className={cx("mira-verdict", `mira-verdict--${state}`)} aria-label="Verdict">
      <p className="mira-verdict__sentence">{sentence}</p>
      {children ? <div className="mira-verdict__evidence">{children}</div> : null}
    </section>
  );
}
