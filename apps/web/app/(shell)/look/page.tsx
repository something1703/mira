import { EmptyState, buttonClass } from "@mira/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { loadProfile } from "../../../src/profile/load";
import { LookRun } from "./look-run";
import { LookStudio } from "./look-studio";

export const metadata: Metadata = { title: "Build a look" };
export const dynamic = "force-dynamic";

/** Look Studio (docs/UX_FLOWS.md §6): slots on the left, the plate on the right. */
export default async function LookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const fn = typeof q.fn === "string" && /^fn_[a-z0-9]{4,20}$/.test(q.fn) ? q.fn : undefined;
  const run = typeof q.run === "string" && /^run_[a-z0-9]{6,64}$/.test(q.run) ? q.run : undefined;
  if (run) return <LookRun runId={run} {...(fn ? { functionId: fn } : {})} />;

  const profile = await loadProfile();
  if (profile.kind === "twin") return <LookStudio {...(fn ? { functionId: fn } : {})} />;
  return (
    <EmptyState
      title="Measure yourself first, then build a look."
      description="A look is checked against your measured profile: your colouring picks the makeup, and your face is compared before anything is shown."
      action={
        <Link href="/capture" className={buttonClass("primary")}>
          Start measuring
        </Link>
      }
    />
  );
}
