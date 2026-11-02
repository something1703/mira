import { buttonClass } from "@mira/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { spendsRealUnits } from "../../../../src/mode";
import { profileState } from "../../../../src/profile-state";
import { SampleRun } from "./sample-run";

export const metadata: Metadata = { title: "A sample run" };

/**
 * "See a recorded run" (docs/UX_FLOWS.md §1, §2 Declined). With no recorded fixtures yet, this runs
 * the real Build Twin flow on a drawn sample face, so the whole pipeline can be seen without a
 * camera or a photo. Every result it produces is labelled as a sample (D25). It is offered only
 * where nothing costs units, and never over a profile the person already has.
 */
export default async function RecordedRun() {
  if (spendsRealUnits()) {
    return (
      <div className="capture">
        <h1 className="mira-display-l">Sample runs are not available here.</h1>
        <p className="lead">
          This version measures real photos with YouCam, so it does not spend units on a drawn face.
          The test results show what MIRA measured on five real people.
        </p>
        <div className="mira-row">
          <Link href="/consent" className={buttonClass("primary")}>
            Start measuring
          </Link>
          <Link href="/tests" className={buttonClass("secondary")}>
            See the test results
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
