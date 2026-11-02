import { buttonClass } from "@mira/ui";
import Link from "next/link";
import { later } from "../routes";

export type JourneyStep = 1 | 2 | 3;

const STEPS: { n: JourneyStep; title: string; what: string; href: string; action: string }[] = [
  {
    n: 1,
    title: "Measure you",
    what: "One face photo. YouCam measures your skin, colouring and face, then the photo is deleted.",
    href: "/consent",
    action: "Start measuring",
  },
  {
    n: 2,
    title: "Match your foundation",
    what: "MIRA checks every shade in a range for free, tries the closest on you without smoothing, and measures which really blends.",
    href: "/shade",
    action: "Match my shade",
  },
  {
    n: 3,
    title: "Build a look",
    what: "An outfit, makeup chosen for it and your hair, on you, with every step checked before you see it.",
    href: "/look",
    action: "Build a look",
  },
];

/**
 * The three steps of MIRA, in order, with where the person is. Shown big on the home page and as
 * a slim bar on the step pages, so it is always clear what comes next.
 */
export function Journey({
  measured,
  current,
  compact = false,
}: {
  measured: boolean;
  current?: JourneyStep;
  compact?: boolean;
}) {
  const next: JourneyStep = measured ? 2 : 1;
  const stateOf = (n: JourneyStep) =>
    n === 1 && measured ? "done" : n === (current ?? next) ? "current" : "todo";

  if (compact) {
    return (
      <nav className="journey journey--compact" aria-label="Your steps">
        <ol>
          {STEPS.map((s) => {
            const state = stateOf(s.n);
            return (
              <li key={s.n} className={`journey__step is-${state}`}>
                <Link href={later(s.n === 1 && measured ? "/profile" : s.href)}>
                  <span className="journey__num" aria-hidden="true">
                    {state === "done" ? "✓" : s.n}
                  </span>
                  <span>{s.title}</span>
                  {state === "done" ? <span className="mira-sr-only">(done)</span> : null}
                  {state === "current" ? (
                    <span className="mira-sr-only">(you are here)</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }

  return (
    <ol className="journey" aria-label="How MIRA works, in three steps">
      {STEPS.map((s) => {
        const state = stateOf(s.n);
        const locked = s.n > 1 && !measured;
        return (
          <li key={s.n} className={`journey__card is-${state}`}>
            <span className="journey__num" aria-hidden="true">
              {state === "done" ? "✓" : s.n}
            </span>
            <h2 className="mira-title">{s.title}</h2>
            <p>{s.what}</p>
            {state === "done" ? (
              <p className="journey__status">
                Done. <Link href={later("/profile")}>See your results</Link>
              </p>
            ) : locked ? (
              <p className="journey__status mira-muted">After step 1</p>
            ) : (
              <Link
                href={later(s.href)}
                className={buttonClass(state === "current" ? "primary" : "secondary")}
              >
                {s.action}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
