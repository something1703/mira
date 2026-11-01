"use client";

import { Button, CloseIconButton } from "@mira/ui";
import { useEffect, useRef, useState } from "react";

/**
 * The Ask MIRA panel shell (docs/UX_FLOWS.md §9): a side panel on desktop, a sheet on mobile,
 * available on every screen. Phase 7 fills it; until then it says so, using the "unavailable"
 * copy, because every tool still works from its own screen.
 */
export function AskMiraPanel() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={toggle}
        variant="secondary"
        aria-expanded={open}
        aria-controls="ask-mira"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        Ask MIRA
      </Button>
      {open ? (
        <aside id="ask-mira" className="ask" aria-label="Ask MIRA">
          <div className="ask__head">
            <h2 ref={heading} tabIndex={-1} className="mira-title">
              Ask MIRA
            </h2>
            <CloseIconButton
              label="Close Ask MIRA"
              onClick={() => {
                setOpen(false);
                toggle.current?.focus();
              }}
            />
          </div>
          <div className="ask__body">
            <p>
              The assistant is unavailable right now. Every tool still works from its own screen.
            </p>
          </div>
        </aside>
      ) : null}
    </>
  );
}
