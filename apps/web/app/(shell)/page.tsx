import { Ring } from "@mira/ui";
import Link from "next/link";
import { profileState } from "../../src/profile-state";
import { later } from "../../src/routes";
import { Journey } from "../../src/shell/Journey";

/** Welcome (docs/UX_FLOWS.md §1): what MIRA is, the three steps, and where the person is. */
export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const preview = (await searchParams).profile;
  const state = await profileState(typeof preview === "string" ? preview : undefined);
  const measured = state === "returning";

  return (
    <div className="home">
      <header className="home__head">
        <Ring mode="reading" value={1 / 3} label="The Ring: MIRA's measuring scale at rest" />
        <div>
          <h1 className="mira-display-xl">{measured ? "Welcome back." : "Look, measured."}</h1>
          <p className="lead">
            {measured
              ? "Your measured profile is saved. Pick the next step."
              : "Try makeup and outfits on your own photo, with no skin smoothing, and see a measured check of every preview, so you know it shows the real colour on you."}
          </p>
        </div>
      </header>

      <Journey measured={measured} />

      {measured ? (
        <p className="home__more">
          Also: <Link href={later("/proof")}>Check my progress</Link> ·{" "}
          <Link href="/event">Plan an event</Link>
        </p>
      ) : null}
      <p className="home__more mira-small">
        {measured ? "About MIRA:" : "New here?"} <Link href="/how-it-works">How MIRA works</Link> ·{" "}
        <Link href="/tests">What we tested on real photos</Link>
        {measured ? null : (
          <>
            {" "}
            · <Link href={later("/runs/recorded")}>See a sample run</Link>
          </>
        )}
      </p>
    </div>
  );
}
