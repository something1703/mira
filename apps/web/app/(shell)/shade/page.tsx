import { EmptyState, buttonClass } from "@mira/ui";
import type { Twin } from "@mira/schemas";
import type { Metadata } from "next";
import Link from "next/link";
import { loadProfile } from "../../../src/profile/load";
import { ShadeFlow } from "./shade-flow";
import { ShadeRun } from "./shade-run";

export const metadata: Metadata = { title: "Match my shade" };
export const dynamic = "force-dynamic";

const hasSkinColour = (twin: Twin) => twin.metrics["colour.skin"]?.kind === "colour";

/** Shade (docs/UX_FLOWS.md §5): choose a range, see it ranked for free, render the closest. */
export default async function ShadePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const run = typeof q.run === "string" && /^run_[a-z0-9]{6,64}$/.test(q.run) ? q.run : undefined;
  if (run) return <ShadeRun runId={run} />;

  const profile = await loadProfile();
  if (profile.kind === "twin" && hasSkinColour(profile.twin)) {
    return <ShadeFlow retry={q.retry === "1"} />;
  }
  return (
    <EmptyState
      title={
        profile.kind === "twin"
          ? "MIRA needs your skin colour to match a shade."
          : "Measure yourself first, then match a shade."
      }
      description={
        profile.kind === "twin"
          ? "Your profile has no skin colour reading. Retake the colouring group to add one."
          : "Shade matching compares every shade with the colour MIRA measured on your skin."
      }
      action={
        profile.kind === "twin" ? (
          <Link href="/capture?only=colouring" className={buttonClass("primary")}>
            Retake colouring
          </Link>
        ) : (
          <Link href="/consent" className={buttonClass("primary")}>
            Start measuring
          </Link>
        )
      }
    />
  );
}
