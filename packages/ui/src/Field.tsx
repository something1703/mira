import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  /** What is wrong and how to fix it. */
  error?: string;
  id?: string;
}

/** A labelled input. `type="checkbox"` renders the label beside the box. */
export function Field({ label, hint, error, id, className, type = "text", ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const isCheckbox = type === "checkbox";
  const input = (
    <input
      id={inputId}
      type={type}
      className={cx(isCheckbox ? "mira-check" : "mira-input", error && "has-error", className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      {...rest}
    />
  );
  return (
    <div className={cx("mira-field", isCheckbox && "mira-field--check")}>
      {isCheckbox ? (
        <>
          {input}
          <label htmlFor={inputId}>{label}</label>
        </>
      ) : (
        <>
          <label htmlFor={inputId}>{label}</label>
          {input}
        </>
      )}
      {hint ? (
        <p id={hintId} className="mira-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mira-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
