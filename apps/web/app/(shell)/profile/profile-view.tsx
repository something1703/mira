import { Banner, Reading, buttonClass } from "@mira/ui";
import {
  groupOf,
  type Metric,
  type MissingReading,
  type Twin,
  type TwinGroupName,
} from "@mira/schemas";
import Link from "next/link";
import type { CSSProperties } from "react";
import { confidenceWords, formatDate, formatMetric } from "../../../src/profile/format";
import {
  FITZPATRICK_NOTE,
  GROUP_TITLES,
  NOISE_MISSING,
  captionOf,
  orderMetrics,
  missingName,
  reasonCopy,
  retryLabel,
} from "../../../src/profile/copy";
import { later } from "../../../src/routes";

const ORDER: readonly TwinGroupName[] = ["skin", "colouring", "face", "hair"];
const STATUS_WORDS = {
  measured: "Measured",
  partial: "Partly measured",
  not_measured: "Not measured",
} as const;

function Missing({ item }: { item: MissingReading }) {
  return (
    <Reading
      state="unavailable"
      caption={missingName(item.reading)}
      reason={reasonCopy(item.reason)}
    />
  );
}

function Readings({ twin, group }: { twin: Twin; group: TwinGroupName }) {
  const metrics = orderMetrics(Object.values(twin.metrics).filter((m) => groupOf(m.id) === group));
  const colours = metrics.filter(
    (m): m is Extract<Metric, { kind: "colour" }> => m.kind === "colour",
  );
  const others = metrics.filter((m) => m.kind !== "colour");
  return (
    <>
      {colours.length > 0 ? (
        <ul className="profile__chips" aria-label="Measured colours">
          {colours.map((m) => (
            <li key={m.id} className="profile__chip">
              <span className="profile__mat">
                <span className="profile__sample" style={{ "--chip": m.hex } as CSSProperties} />
              </span>
              <span className="profile__chip-name">{captionOf(m.id)}</span>
              <span className="mira-caption mira-figures">{m.hex}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="profile__grid">
        {others.map((m) => {
          const f = formatMetric(m);
          return (
            <Reading
              key={m.id}
              caption={captionOf(m.id)}
              value={f.value}
              {...(f.unit ? { unit: f.unit } : {})}
              confidence={confidenceWords(m, twin.noiseFloors[m.id])}
            />
          );
        })}
        {twin.groups[group].missing.map((item) => (
          <Missing key={item.reading} item={item} />
        ))}
      </div>
      {group === "colouring" && twin.metrics["colour.fitzpatrick_band"] ? (
        <p className="mira-small mira-muted">{FITZPATRICK_NOTE}</p>
      ) : null}
    </>
  );
}

/** The measured profile (docs/UX_FLOWS.md §4): Skin, Colouring, Face, Hair, each with its state. */
export function ProfileView({ twin }: { twin: Twin }) {
  const noNoise = Object.keys(twin.noiseFloors).length === 0;
  return (
    <div className="profile">
      {twin.synthetic ? (
        <Banner kind="info">
          Sample results. This profile was built from sample data in mock mode, not from a photo of
          you.
        </Banner>
      ) : null}
      <header>
        <h1 className="mira-display-l">Your measured profile</h1>
        <p className="lead">
          Measured {formatDate(twin.updatedAt)} in{" "}
          {twin.captureMeta.mode === "hd" ? "HD" : "standard"} detail from{" "}
          {twin.captureMeta.source === "camera" ? "the camera" : "an uploaded photo"}. MIRA keeps
          these numbers and not the photos.
        </p>
      </header>

      {ORDER.map((group) => {
        const g = twin.groups[group];
        return (
          <section key={group} className="profile__group" aria-labelledby={`g-${group}`}>
            <div className="profile__head">
              <h2 id={`g-${group}`} className="mira-title">
                {GROUP_TITLES[group]}
              </h2>
              <p className="mira-small mira-muted" data-status={g.status}>
                {STATUS_WORDS[g.status]}
              </p>
              {g.status !== "measured" ? (
                <Link
                  href={later(`/capture?only=${group}`)}
                  className={buttonClass("secondary")}
                  aria-label={`${retryLabel(group, g.missing)}: ${GROUP_TITLES[group]}`}
                >
                  {retryLabel(group, g.missing)}
                </Link>
              ) : null}
            </div>
            <Readings twin={twin} group={group} />
          </section>
        );
      })}

      {noNoise && twin.groups.skin.status !== "not_measured" ? (
        <Banner
          kind="info"
          action={
            <Link href={later("/capture?step=repeats")} className={buttonClass("secondary")}>
              Add captures
            </Link>
          }
        >
          {NOISE_MISSING} Progress checks need it.
        </Banner>
      ) : null}

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
        <Link href={later("/settings/privacy")} className={buttonClass("quiet")}>
          Privacy and my data
        </Link>
      </div>
    </div>
  );
}
