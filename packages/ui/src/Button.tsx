import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import { BusyIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "critical";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows progress and blocks repeat presses. Say what is happening in `children`. */
  busy?: boolean;
}

/** Buttons name the action: "Match my shade", not "Submit" (docs/COPY.md §2). */
export function Button({
  variant = "primary",
  busy = false,
  className,
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("mira-btn", `mira-btn--${variant}`, busy && "is-busy", className)}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <BusyIcon className="mira-spin" /> : null}
      {children}
    </button>
  );
}
