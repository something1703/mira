"use client";

import { Button, Field, buttonClass } from "@mira/ui";
import { DISCLAIMER } from "@mira/schemas/claim-linter";
import Link from "next/link";
import { useId, useState } from "react";
import { HELD_HOURS } from "../../../src/capture/copy";
import { later } from "../../../src/routes";

/** What a person who declines can look at instead, by what this server can show for free (D25). */
const INSTEAD = {
  recorded: {
    title: "You can still try MIRA with a recorded run.",
    lead: "A recorded run replays real YouCam outputs captured earlier. Nothing about you is measured.",
    href: "/runs/recorded",
    action: "See a recorded run",
  },
  sample: {
    title: "You can still look around MIRA with sample results.",
    lead: "Sample results are made-up numbers that show how MIRA looks. Nothing about you is measured.",
    href: "/runs/recorded",
    action: "See sample results",
  },
  tests: {
    title: "You can still see what MIRA measures.",
    lead: "The test results show five real people measured by YouCam, with every number. Nothing about you is measured.",
    href: "/tests",
    action: "See the test results",
  },
} as const;

/** Consent and privacy (docs/UX_FLOWS.md §2): default, ticked, declined. */
export function ConsentForm({ instead }: { instead: keyof typeof INSTEAD }) {
  const [agreed, setAgreed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const reasonId = useId();

  if (declined) {
    const offer = INSTEAD[instead];
    return (
      <div className="consent">
        <h1 className="mira-display-l">{offer.title}</h1>
        <p className="lead">{offer.lead}</p>
        <div className="mira-row">
          <Link href={later(offer.href)} className={buttonClass("primary")}>
            {offer.action}
          </Link>
          <Button
            variant="quiet"
            onClick={() => {
              setDeclined(false);
            }}
          >
            Go back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="consent">
      <h1 className="mira-display-l">Before the camera opens</h1>
      <div className="consent__list">
        <section aria-labelledby="c-measured">
          <h2 id="c-measured" className="mira-title">
            What MIRA measures
          </h2>
          <p>
            Your skin, your colouring (skin, lip, eye and hair colour), your face proportions and
            your hair. YouCam&apos;s analysis does the measuring.
          </p>
        </section>
        <section aria-labelledby="c-photos">
          <h2 id="c-photos" className="mira-title">
            What happens to your photos
          </h2>
          <p>
            Each photo is used for the measurement and deleted when the run ends. The full-body and
            hand photos wait for the clothes and jewellery they are used on, and are deleted after{" "}
            {HELD_HOURS} hours at most. MIRA keeps a photo only if you save that specific look.
          </p>
        </section>
        <section aria-labelledby="c-kept">
          <h2 id="c-kept" className="mira-title">
            What MIRA keeps
          </h2>
          <p>
            Numbers only, in your measured profile. You can see every stored number and delete all
            of them.
          </p>
        </section>
        <section aria-labelledby="c-not">
          <h2 id="c-not" className="mira-title">
            What MIRA is not
          </h2>
          <p>{DISCLAIMER}</p>
        </section>
        <section aria-labelledby="c-delete">
          <h2 id="c-delete" className="mira-title">
            How to delete everything
          </h2>
          <p>Choose Delete my profile under Privacy in settings. It removes every stored number.</p>
        </section>
      </div>

      <div className="consent__confirm">
        <Field
          type="checkbox"
          label="I understand and want to continue"
          checked={agreed}
          onChange={(e) => {
            setAgreed(e.target.checked);
          }}
        />
        {agreed ? (
          <Link href={later("/capture")} className={buttonClass("primary")}>
            Continue to your photo
          </Link>
        ) : (
          <>
            <Button disabled aria-describedby={reasonId}>
              Continue to your photo
            </Button>
            <p id={reasonId} className="mira-small mira-muted">
              Tick the box to continue
            </p>
          </>
        )}
        <Button
          variant="quiet"
          onClick={() => {
            setDeclined(true);
          }}
        >
          No thanks
        </Button>
      </div>
    </div>
  );
}
