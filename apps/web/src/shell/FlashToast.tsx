"use client";

import { Toast, ToastRegion } from "@mira/ui";
import { useEffect, useState } from "react";
import { FLASH_EVENT, takeFlash } from "./flash";

/** The shell's one live region for toasts. Keep it mounted so screen readers announce additions. */
export function FlashToast() {
  const [message, setMessage] = useState<string | undefined>();
  useEffect(() => {
    const show = () => {
      const next = takeFlash();
      if (next !== undefined) setMessage(next);
    };
    show();
    window.addEventListener(FLASH_EVENT, show);
    return () => {
      window.removeEventListener(FLASH_EVENT, show);
    };
  }, []);
  return (
    <ToastRegion>
      {message ? (
        <Toast
          onDismiss={() => {
            setMessage(undefined);
          }}
        >
          {message}
        </Toast>
      ) : null}
    </ToastRegion>
  );
}
