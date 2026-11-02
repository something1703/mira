import type { ReactNode } from "react";
import { cx } from "./cx";
import { CheckIcon, CloseIcon, InfoIcon } from "./icons";

export type ToastKind = "success" | "info";

export interface ToastProps {
  kind?: ToastKind;
  /** Reuse the action's own verb: "Shade matched", "Look built", "Profile deleted". */
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}

export function Toast({ kind = "success", children, action, onDismiss }: ToastProps) {
  const Icon = kind === "success" ? CheckIcon : InfoIcon;
  return (
    <div className={cx("mira-toast", `mira-toast--${kind}`)}>
      <Icon />
      <p className="mira-toast__text">{children}</p>
      {action}
      {onDismiss ? (
        <button type="button" className="mira-banner__dismiss" onClick={onDismiss}>
          <CloseIcon />
          <span className="mira-sr-only">Dismiss</span>
        </button>
      ) : null}
    </div>
  );
}

/** Live region that holds toasts. Keep it mounted so screen readers announce what is added. */
export function ToastRegion({ children }: { children?: ReactNode }) {
  return (
    <div className="mira-toast-region" role="status" aria-live="polite" aria-label="Notifications">
      {children}
    </div>
  );
}
