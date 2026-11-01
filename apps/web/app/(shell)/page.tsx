import { Ring, buttonClass } from "@mira/ui";
import Link from "next/link";
import { profileState } from "../../src/profile-state";
import { later } from "../../src/routes";

/** Welcome (docs/UX_FLOWS.md §1): first visit, returning, and profile deleted. */
export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const preview = (await searchParams).profile;
  const state = await profileState(typeof preview === "string" ? preview : undefined);

  return (
    <div className="hero">
      <Ring mode="reading" value={1 / 3} label="The Ring: MIRA's measuring scale at rest" />
      {state === "returning" ? (
        <div>
          <h1 className="mira-display-xl">Welcome back.</h1>
          <p className="lead">Your measured profile is saved. Pick up where you left off.</p>
          <div className="mira-row">
            <Link href={later("/shade")} className={buttonClass("primary")}>
              Match my shade
            </Link>
            <Link href={later("/look")} className={buttonClass("secondary")}>
              Build a look
            </Link>
            <Link href={later("/proof")} className={buttonClass("secondary")}>
              Check my progress
            </Link>
          </div>
        </div>
      ) : (
        <div>
          <h1 className="mira-display-xl">Look, measured.</h1>
          <p className="lead">
            MIRA measures you once, then shows makeup and clothes on you without smoothing your
            skin, and checks every preview before you see it.
          </p>
          <div className="mira-row">
            <Link href="/consent" className={buttonClass("primary")}>
              Start measuring
            </Link>
            <Link href={later("/runs/recorded")} className={buttonClass("secondary")}>
              See a recorded run
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
