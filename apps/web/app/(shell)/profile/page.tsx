import { EmptyState, ErrorPanel, buttonClass } from "@mira/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { loadProfile } from "../../../src/profile/load";
import { BuildingView } from "./building-view";
import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "Your measured profile" };
export const dynamic = "force-dynamic";

/** Measured profile (docs/UX_FLOWS.md §4): building, ready, partial, nothing yet, deleted. */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const run = (await searchParams).run;
  if (typeof run === "string" && /^run_[a-z0-9]{6,64}$/.test(run))
    return <BuildingView runId={run} />;

  const profile = await loadProfile();
  if (profile.kind === "twin") return <ProfileView twin={profile.twin} />;
  if (profile.kind === "error") {
    return (
      <ErrorPanel
        title="Your profile could not be read."
        why="MIRA could not reach the service that holds it."
        next="Try again in a moment. Nothing was changed."
        actions={
          <Link href="/profile" className={buttonClass("secondary")}>
            Try again
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      title={profile.deleted ? "Your profile was deleted." : "No measured profile yet."}
      description={
        profile.deleted
          ? "Every stored number was removed. You can measure again whenever you like."
          : "Measure once and MIRA keeps the numbers, not the photos."
      }
      action={
        <Link href="/consent" className={buttonClass("primary")}>
          Start measuring
        </Link>
      }
    />
  );
}
