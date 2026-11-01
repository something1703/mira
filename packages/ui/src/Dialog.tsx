"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read by screen readers after the title: say what will happen. */
  description: string;
  children?: ReactNode;
  /** Buttons, confirm last. A destructive confirm uses the critical variant. */
  actions: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children, actions }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="mira-dialog__overlay" />
        <RadixDialog.Content className="mira-dialog">
          <RadixDialog.Title className="mira-title">{title}</RadixDialog.Title>
          <RadixDialog.Description className="mira-dialog__desc">
            {description}
          </RadixDialog.Description>
          {children}
          <div className="mira-row mira-dialog__actions">{actions}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
