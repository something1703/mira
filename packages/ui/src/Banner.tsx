import type { ReactNode } from "react";
import { cx } from "./cx";
import { CloseIcon, InfoIcon, OfflineIcon, RecordedIcon } from "./icons";

export type BannerKind = "recorded" | "offline" | "budget" | "info";

const ICONS = {
  recorded: RecordedIcon,
  offline: OfflineIcon,
  budget: InfoIcon,
  info: InfoIcon,
} as const;

export interface BannerProps {
  kind: BannerKind;
  children: ReactNode;
  /** A single follow-up action, e.g. "See what uses units". */
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** Page-level notice (docs/UX_FLOWS.md §0). A status, never an alert: it must not interrupt. */
export function Banner({ kind, children, action, onDismiss, className }: BannerProps) {
  const Icon = ICONS[kind];
  return (
    <div role="status" className={cx("mira-banner", `mira-banner--${kind}`, className)}>
      <Icon />
      <p className="mira-banner__text">{children}</p>
      {action}
      {onDismiss ? (
        <button type="button" className="mira-banner__dismiss" onClick={onDismiss}>
          <CloseIcon />
          <span className="mira-sr-only">Dismiss for this session</span>
        </button>
      ) : null}
    </div>
  );
}
