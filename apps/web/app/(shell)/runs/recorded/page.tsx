import { buttonClass } from "@mira/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { profileState } from "../../../../src/profile-state";
import { SampleRun } from "./sample-run";

export const metadata: Metadata = { title: "A sample run" };

/**
 * "See a recorded run" (docs/UX_FLOWS.md §1, §2 Declined). With no recorded fixtures yet, this runs
 * the real Build Twin flow on a drawn sample face, so the whole pipeline can be seen without a
 * camera or a photo. Every result it produces is labelled as a sample (D25). It is offered only in
 * mock mode, where nothing costs units, and never over a profile the person already has.
 */
export default async function RecordedRun() {
  if (process.env.MIRA_MODE === "live") {
    return (
      <div className="capture">
        <h1 className="mira-display-l">Recorded runs are not available here.</h1>
        <p className="lead">
          This version measures real photos only. Start measuring to build yours.
        </p>
        <div className="mira-row">
          <Link href="/consent" className={buttonClass("primary")}>
            Start measuring
          </Link>
        </div>
      </div>
    );
  }
  if ((await profileState(undefined)) === "returning") {
    return (
      <div className="capture">
        <h1 className="mira-display-l">You already have a measured profile.</h1>
        <p className="lead">A sample run would replace it, so MIRA has not started one.</p>
        <div className="mira-row">
          <Link href="/profile" className={buttonClass("primary")}>
            See my profile
          </Link>
        </div>
      </div>
    );
  }
  return <SampleRun />;
}
