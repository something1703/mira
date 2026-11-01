"use client";

import { useEffect, useState } from "react";

/** Whether the browser reports a connection. True until the browser says otherwise. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser state after hydration */
    setOnline(navigator.onLine);
    /* eslint-enable react-hooks/set-state-in-effect */
    const up = () => {
      setOnline(true);
    };
    const down = () => {
      setOnline(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
