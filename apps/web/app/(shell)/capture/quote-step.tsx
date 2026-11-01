"use client";

import { Banner, ErrorPanel, Field, QuoteSheet, Button } from "@mira/ui";
import { Quote } from "@mira/schemas";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { BuildCapture } from "../../../src/capture/flow";

/** What each priced step is, in words. A step YouCam does not run is not listed here. */
const LINE_LABELS: Record<string, string> = {
  skin: "Skin analysis",
  "skin-r1": "Repeat photo 1, skin analysis",
  "skin-r2": "Repeat photo 2, skin analysis",
  tone: "Skin, lip, eye and hair colour",
  fitzpatrick: "Skin tone band",
  face: "Face proportions",
  "hair-density": "Hair density",
  "hair-length": "Hair length",
  "hair-type": "Hair type",
  "hair-frizz": "Hair frizziness",
};

type Load =
  | { s: "quoting" }
  | { s: "ready"; quote: Quote }
  | { s: "error"; message: string }
  | { s: "starting"; quote: Quote };

/**
 * The plan and its price, before a single unit is spent (AGENTS.md §2.4). Steps the person can do
 * without — repeat photos and hair — have a checkbox, and the price is asked for again when one
 * changes. Confirming sends the total the person saw; if the price has risen the build refuses.
 */
export function QuoteStep({
  capture,
  downgraded,
  onCancel,
  onBack,
}: {
  capture: BuildCapture;
  downgraded: boolean;
  onCancel: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ s: "quoting" });
  const [removed, setRemoved] = useState<string[]>([]);
  const [full, setFull] = useState<Quote | undefined>();
  const [note, setNote] = useState<string | undefined>();

  const ask = useCallback(
    async (without: string[]) => {
      setLoad({ s: "quoting" });
      try {
        const res = await fetch("/api/twin/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capture, removed: without }),
        });
        const body = (await res.json()) as { quote?: unknown; error?: string };
        const quote = Quote.safeParse(body.quote);
        if (!res.ok || !quote.success) {
          setLoad({
            s: "error",
            message:
              body.error === "quote_failed"
                ? "MIRA could not confirm what this would cost, so it has not started."
                : "The price could not be worked out.",
          });
          return;
        }
        if (without.length === 0) setFull(quote.data);
        setLoad({ s: "ready", quote: quote.data });
      } catch {
        setLoad({
          s: "error",
          message: "The price could not be worked out. Check your connection.",
        });
      }
    },
    [capture],
  );

  useEffect(() => {
    // Asking for a price is a request to our own server; this is the one place it is made on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state before the request
    void ask([]);
  }, [ask]);

  const start = async (quote: Quote) => {
    setLoad({ s: "starting", quote });
    try {
      const res = await fetch("/api/twin/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capture, removed, confirmedTotal: quote.total }),
      });
      const body = (await res.json()) as { runId?: string; error?: string; quote?: unknown };
      if (res.status === 201 && typeof body.runId === "string") {
        router.push(`/profile?run=${body.runId}`);
        return;
      }
      if (body.error === "quote_changed") {
        setNote("The price changed while you were looking. Check the new total and confirm again.");
        await ask(removed);
        return;
      }
      if (body.error === "over_cap") {
        setNote("This would use more units than this session has left.");
        await ask(removed);
        return;
      }
      setLoad({ s: "error", message: "Measuring could not start. Nothing was used." });
    } catch {
      setLoad({ s: "error", message: "Measuring could not start. Nothing was used." });
    }
  };

  if (load.s === "error") {
    return (
      <ErrorPanel
        title={load.message}
        next="Try again, or go back and change your photos."
        actions={
          <>
            <Button onClick={() => void ask(removed)}>Try again</Button>
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
          </>
        }
      />
    );
  }

  const quote = load.s === "ready" || load.s === "starting" ? load.quote : undefined;
  const optional = (full?.lines ?? []).filter((l) => l.optional);
  return (
    <div className="capture__quote">
      {downgraded ? (
        <Banner kind="info">
          A photo is below HD size, so MIRA will measure in standard detail. A sharper photo gives a
          more detailed reading.
        </Banner>
      ) : null}
      {note ? <Banner kind="info">{note}</Banner> : null}
      <QuoteSheet
        state={
          load.s === "quoting"
            ? "quoting"
            : load.s === "starting"
              ? "confirmed"
              : quote?.overCap
                ? "over_cap"
                : "ready"
        }
        title="Measuring you"
        lines={(quote?.lines ?? []).map((l) => ({
          label: `${LINE_LABELS[l.nodeId] ?? l.nodeId}${l.cached ? " (saved result)" : ""}`,
          units: l.units,
        }))}
        {...(quote ? { unitsLeft: quote.sessionUnitsLeft } : {})}
        confirmLabel="Start measuring"
        onConfirm={() => {
          if (quote) void start(quote);
        }}
        onCancel={onCancel}
      />
      {optional.length > 0 ? (
        <fieldset className="capture__optional" disabled={load.s !== "ready"}>
          <legend className="mira-title">Steps you can leave out</legend>
          {optional.map((l) => (
            <Field
              key={l.nodeId}
              type="checkbox"
              label={`${LINE_LABELS[l.nodeId] ?? l.nodeId} (${String(l.units)} units)`}
              checked={!removed.includes(l.nodeId)}
              onChange={(e) => {
                const next = e.target.checked
                  ? removed.filter((x) => x !== l.nodeId)
                  : [...removed, l.nodeId];
                setRemoved(next);
                void ask(next);
              }}
            />
          ))}
        </fieldset>
      ) : null}
      <p className="mira-small mira-muted">
        Your photos are deleted when the run ends. A failed step is not charged.
      </p>
      <Button variant="quiet" onClick={onBack} disabled={load.s === "starting"}>
        Back
      </Button>
    </div>
  );
}
