"use client";

import { Prefs } from "@mira/schemas";
import { Toggle } from "@mira/ui";
import { useEffect, useState } from "react";

/**
 * Whether anonymised readings may feed brand summaries. Off until the person says yes; turning it
 * off removes what was contributed. What is shared is listed here, in the same words the brand
 * console's rows use (docs/DATA_MODEL.md §3).
 */
export function ContributeChoice() {
  const [value, setValue] = useState<boolean | undefined>();
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/prefs", { cache: "no-store" })
      .then(async (r) => (r.ok ? Prefs.safeParse(await r.json()) : undefined))
      .then((p) => {
        if (!alive) return;
        if (p?.success) setValue(p.data.contribute);
        else setProblem(true);
      })
      .catch(() => {
        if (alive) setProblem(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const change = async (next: boolean) => {
    setValue(next);
    const res = await fetch("/api/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contribute: next }),
    }).catch(() => undefined);
    if (!res?.ok) {
      setValue(!next);
      setProblem(true);
    } else {
      setProblem(false);
    }
  };

  return (
    <section className="privacy__section" aria-labelledby="contribute-h">
      <h2 id="contribute-h" className="mira-title">
        Anonymised summaries for brands
      </h2>
      <p>
        If you say yes, MIRA adds one anonymous row when you measure your skin colour and one when
        you build a look: your skin colour as numbers, your measured skin-tone band, and the week.
        No name, no photo, no user id. A brand sees a group only when it holds at least twenty
        people. You can turn this off at any time, and doing so removes your row.
      </p>
      <Toggle
        label="Share anonymised readings with brand summaries"
        checked={value === true}
        disabled={value === undefined}
        onCheckedChange={(v) => void change(v)}
      />
      {problem ? <p role="alert">That choice could not be saved. It was not changed.</p> : null}
    </section>
  );
}
