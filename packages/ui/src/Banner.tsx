import type { ReactNode } from "react";
import { cx } from "./cx";
import { CloseIcon, InfoIcon, OfflineIcon, RecordedIcon } from "./icons";

/** A 44 px icon-only close control with a screen-reader name. */
export function CloseIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mira-banner__dismiss" onClick={onClick}>
      <CloseIcon />
      <span className="mira-sr-only">{label}</span>
    </button>
  );
}

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
      {onDismiss ? <CloseIconButton label="Dismiss for this session" onClick={onDismiss} /> : null}
    </div>
  );
}
