"use client";

import { Banner } from "@mira/ui";
import { useEffect, useState } from "react";

const DISMISSED = "mira-recorded-dismissed";

/** Global notices from docs/UX_FLOWS.md §0 that need no run state: recorded run and offline. */
export function SessionBanners({
  mock,
  recorded,
  realYouCam = false,
}: {
  mock: boolean;
  recorded: boolean;
  realYouCam?: boolean;
}) {
  const [online, setOnline] = useState(true);
  const [recordedDismissed, setRecordedDismissed] = useState(true);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser state after hydration */
    setOnline(navigator.onLine);
    try {
      setRecordedDismissed(sessionStorage.getItem(DISMISSED) === "1");
    } catch {
      setRecordedDismissed(false);
    }
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

  return (
    <>
      {mock && !recordedDismissed ? (
        <Banner
          kind="recorded"
          onDismiss={() => {
            setRecordedDismissed(true);
            try {
              sessionStorage.setItem(DISMISSED, "1");
            } catch {
              // Not persisted; the banner returns on the next page load.
            }
          }}
        >
          {recorded
            ? "You are viewing a recorded run. Results are real YouCam outputs captured earlier."
            : "You are viewing sample results. Nothing on this screen was measured on you."}
        </Banner>
      ) : null}
      {realYouCam ? (
        <Banner kind="info">
          Live measuring: your photos are measured by YouCam, and each run uses real units after you
          confirm its price.
        </Banner>
      ) : null}
      {online ? null : (
        <Banner kind="offline">
          You are offline. Measurements will resume when you reconnect.
        </Banner>
      )}
    </>
  );
}
