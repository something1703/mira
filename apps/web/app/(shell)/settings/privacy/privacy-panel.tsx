"use client";

import { Banner, Button, Dialog, EmptyState, buttonClass } from "@mira/ui";
import { groupOf, type TwinGroupName } from "@mira/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HELD_HOURS } from "../../../../src/capture/copy";
import { GROUP_TITLES, captionOf, orderMetrics } from "../../../../src/profile/copy";
import { formatDate, formatMetric } from "../../../../src/profile/format";
import type { Inventory } from "../../../../src/profile/inventory";
import { flash } from "../../../../src/shell/flash";

const ORDER: readonly TwinGroupName[] = ["skin", "colouring", "face", "hair"];
const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

const PHOTO_KINDS: Record<string, string> = {
  face: "Face photo",
  repeat: "Repeat face photo",
  body: "Full-body photo",
  hand: "Hand photo",
  hair_front: "Hair photo, front",
  hair_right: "Hair photo, right",
  hair_left: "Hair photo, left",
};

type Phase = "idle" | "confirm" | "deleting" | "blocked" | "failed";

/** What a deletion removed, from the counts it left behind (never the values). */
function describeDeletion(d: Inventory["deletions"][number]): string {
  const r = d.removed;
  return [
    plural(r.readings, "reading"),
    ...(r.savedLooks > 0 ? [plural(r.savedLooks, "saved look")] : []),
    ...(r.savedImages > 0 ? [plural(r.savedImages, "saved image")] : []),
    ...(r.proofs > 0 ? [plural(r.proofs, "progress check")] : []),
    plural(r.runs, "run"),
  ].join(", ");
}

export function PrivacyPanel({ inventory }: { inventory: Inventory }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const { twin } = inventory;
  const hasAnything =
    twin !== null ||
    inventory.savedLooks.length > 0 ||
    inventory.proofs > 0 ||
    inventory.runs.length > 0 ||
    inventory.pendingUploads > 0;

  const remove = async () => {
    setPhase("deleting");
    try {
      const res = await fetch("/api/twin", { method: "DELETE" });
      if (res.status === 409) {
        setPhase("blocked");
        return;
      }
      if (!res.ok) {
        setPhase("failed");
        return;
      }
      flash("Profile deleted");
      router.push("/");
      router.refresh();
    } catch {
      setPhase("failed");
    }
  };

  return (
    <div className="privacy">
      <header>
        <h1 className="mira-display-l">Privacy and my data</h1>
        <p className="lead">
          Your photos are deleted when each run ends, or after {HELD_HOURS} hours if they are
          waiting for a later one. MIRA keeps numbers only, and every one is listed here.
        </p>
      </header>

      {phase === "blocked" ? (
        <Banner kind="info">
          A measuring run is still going. Wait for it to finish, then delete your profile.
        </Banner>
      ) : null}
      {phase === "failed" ? (
        <Banner kind="info">
          Your profile could not be deleted just now. Nothing was removed. Try again in a moment.
        </Banner>
      ) : null}

      {hasAnything ? (
        <>
          {twin ? (
            <section aria-labelledby="p-readings" className="privacy__section">
              <h2 id="p-readings" className="mira-title">
                Your readings
              </h2>
              <p className="mira-small mira-muted">
                Measured {formatDate(twin.updatedAt)} in{" "}
                {twin.captureMeta.mode === "hd" ? "HD" : "standard"} detail
                {twin.synthetic ? ". These are sample results, not measurements of you" : ""}.
              </p>
              {ORDER.map((group) => {
                const rows = orderMetrics(
                  Object.values(twin.metrics).filter((m) => groupOf(m.id) === group),
                );
                if (rows.length === 0) return null;
                return (
                  <table key={group} className="privacy__table">
                    <caption>{GROUP_TITLES[group]}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Reading</th>
                        <th scope="col">Value</th>
                        <th scope="col">Where it came from</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => {
                        const f = formatMetric(m);
                        return (
                          <tr key={m.id}>
                            <th scope="row">{captionOf(m.id)}</th>
                            <td className="mira-figures">
                              {f.value}
                              {f.unit ? ` ${f.unit}` : ""}
                            </td>
                            <td className="mira-small mira-muted">
                              {m.source.feature} {m.source.version}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })}
              {Object.keys(twin.noiseFloors).length > 0 ? (
                <table className="privacy__table">
                  <caption>Spread between repeat captures</caption>
                  <thead>
                    <tr>
                      <th scope="col">Reading</th>
                      <th scope="col">Captures</th>
                      <th scope="col">Spread (points out of 100)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(twin.noiseFloors).map(([id, f]) => (
                      <tr key={id}>
                        <th scope="row">{captionOf(id)}</th>
                        <td className="mira-figures">{f.capturesPerSession}</td>
                        <td className="mira-figures">{f.sW.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              <p className="mira-small mira-muted">
                Capture details:{" "}
                {twin.captureMeta.source === "camera" ? "camera" : "uploaded photo"},{" "}
                {plural(twin.captureMeta.repeatsCaptured, "repeat capture")}, camera checks{" "}
                {twin.captureMeta.qualityChecksPassed === null
                  ? "not applicable"
                  : twin.captureMeta.qualityChecksPassed
                    ? "passed"
                    : "not all passed"}
                .
              </p>
            </section>
          ) : null}

          <section aria-labelledby="p-other" className="privacy__section">
            <h2 id="p-other" className="mira-title">
              Everything else stored
            </h2>
            <ul className="privacy__list">
              <li>
                Saved looks: {plural(inventory.savedLooks.length, "look")},{" "}
                {plural(
                  inventory.savedLooks.reduce((n, l) => n + l.images, 0),
                  "image",
                )}
              </li>
              <li>Progress checks: {inventory.proofs}</li>
              <li>
                Runs kept: {inventory.runs.length}, using{" "}
                {inventory.runs.reduce((n, r) => n + r.unitsSpent, 0)} units in total
              </li>
              <li>
                Photos waiting to be used: {inventory.pendingUploads}
                {inventory.heldPhotos.length > 0 ? (
                  <ul className="privacy__list">
                    {inventory.heldPhotos.map((p) => (
                      <li key={p.at + p.kind}>
                        {PHOTO_KINDS[p.kind] ?? "Photo"}, deleted automatically by{" "}
                        {formatDate(p.expiresAt)}, {p.expiresAt.slice(11, 16)} UTC
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            </ul>
          </section>
        </>
      ) : (
        <EmptyState
          title="MIRA is storing nothing about you."
          description="No readings, saved looks or photos are held."
          action={
            <Link href="/consent" className={buttonClass("primary")}>
              Start measuring
            </Link>
          }
        />
      )}

      <section aria-labelledby="p-history" className="privacy__section">
        <h2 id="p-history" className="mira-title">
          What was deleted
        </h2>
        {inventory.deletions.length === 0 ? (
          <p className="mira-muted">Nothing has been deleted yet.</p>
        ) : (
          <ul className="privacy__list">
            {inventory.deletions.map((d) => (
              <li key={d.id}>
                {formatDate(d.at)}: {describeDeletion(d)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mira-row">
        <a href="/api/twin/export" download className={buttonClass("secondary")}>
          Download my data
        </a>
        <Button
          variant="critical"
          disabled={!hasAnything || phase === "deleting"}
          onClick={() => {
            setPhase("confirm");
          }}
        >
          Delete my profile
        </Button>
      </div>

      <Dialog
        open={phase === "confirm" || phase === "deleting"}
        onOpenChange={(open) => {
          if (!open && phase !== "deleting") setPhase("idle");
        }}
        title="Delete my profile?"
        description="This removes every reading listed here, your saved looks and their images, your runs and any saved results. It cannot be undone."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={phase === "deleting"}
              onClick={() => {
                setPhase("idle");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="critical"
              disabled={phase === "deleting"}
              onClick={() => void remove()}
            >
              {phase === "deleting" ? "Deleting" : "Delete my profile"}
            </Button>
          </>
        }
      >
        {phase === "deleting" ? (
          <p role="status" className="mira-small">
            Deleting your profile
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
