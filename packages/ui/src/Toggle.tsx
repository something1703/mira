"use client";

import * as Switch from "@radix-ui/react-switch";
import { useId } from "react";

export interface ToggleProps {
  label: string;
  description?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Toggle({ label, description, ...rest }: ToggleProps) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className="mira-toggle">
      <Switch.Root id={id} className="mira-switch" aria-describedby={descId} {...rest}>
        <Switch.Thumb className="mira-switch__thumb" />
      </Switch.Root>
      <div>
        <label htmlFor={id}>{label}</label>
        {description ? (
          <p id={descId} className="mira-field__hint">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
