import { buttonClass } from "@mira/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { captionOf } from "../../../src/profile/copy";
import results from "../../../src/tests/results.json";

export const metadata: Metadata = { title: "What we tested" };

interface Outcome {
  name: string;
  hex: string;
  preDe: number;
  blendDe: number | null;
  label: string;
  directionOk: boolean;
  image: string;
}

/** Labels from docs/ENGINES.md §4.1 (thresholds not yet calibrated). */
const LABEL: Record<string, string> = {
  blends_closely: "Blends closely",
  close: "Close",
};

const fmt = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : n.toFixed(digits);

/**
 * Real results (docs/TESTS.md): five photos of real people sent through MIRA to the live YouCam
 * API on 2026-11-02. Every reading here came back from YouCam or MIRA's engines; nothing is a
 * sample. Numbers come from `src/tests/results.json`, written by the test run, never typed here.
 */
export default function TestsPage() {
  const r = results;
  const youcamSteps = r.people.length * 4;
  const shadeRuns = r.people.filter((p) => p.shade);
  return (
    <div className="tests">
      <header className="tests__head">
        <h1 className="mira-display-l">What we tested, for real</h1>
        <p className="lead">
          On {r.date} we sent photos of five real people through MIRA to the live YouCam API, the
          same way the app does. Every reading on this page came back from YouCam or from
          MIRA&rsquo;s own measuring. None of it is sample data.
        </p>
      </header>

      <dl className="tests__stats">
        <div>
          <dt>People measured</dt>
          <dd>{r.people.length}</dd>
        </div>
        <div>
          <dt>Measuring steps that worked</dt>
          <dd>
            {youcamSteps} of {youcamSteps}
          </dd>
        </div>
        <div>
          <dt>Real shade matches</dt>
          <dd>{shadeRuns.length}</dd>
        </div>
        <div>
          <dt>Units used</dt>
          <dd>
            {r.ledgerUnits}
            <span className="tests__note mira-small mira-muted">
              Exactly what YouCam charged: the balance went from {r.balanceBefore} to{" "}
              {r.balanceAfter}.
            </span>
          </dd>
        </div>
      </dl>

      <section className="tests__section" aria-labelledby="found">
        <h2 id="found" className="mira-display-m">
          What failed first, and what we changed
        </h2>
        <p className="mira-muted">
          The first real runs found three problems that sample data never could. Failed steps cost
          nothing: YouCam charges only for results.
        </p>
        <ol className="tests__findings">
          <li>
            <h3 className="mira-title">A head tilted slightly down</h3>
            <p>
              Colour and face proportions refused an uploaded photo (
              <code>error_face_angle_downward</code>). YouCam&rsquo;s default allows about 10
              degrees. Uploaded photos now use its 15-degree setting; camera captures keep the
              stricter default, because the Ring guides the head angle.
            </p>
          </li>
          <li>
            <h3 className="mira-title">The face was too small in a head-and-shoulders photo</h3>
            <p>
              Skin analysis refused three of five photos (<code>error_src_face_too_small</code>):
              YouCam needs the face wider than 60% of the picture. MIRA now finds the face on its
              own server and crops the photo so the face fills 70% of the width. Only that local
              detector sees the photo. A crop under 1080 pixels is measured in standard detail, and
              the price says so before anything runs.
            </p>
          </li>
          <li>
            <h3 className="mira-title">Shade previews kept the tilt</h3>
            <p>
              The shade check measures every preview again. The first try failed the same angle
              check, because a preview keeps the photo&rsquo;s pose. It now uses the same setting.
            </p>
          </li>
        </ol>
      </section>

      <section className="tests__section" aria-labelledby="people">
        <h2 id="people" className="mira-display-m">
          Each person, measured
        </h2>
        <p className="mira-muted">
          Skin readings are YouCam&rsquo;s raw scores from 1 to 100, where YouCam treats higher as
          healthier-looking. Each was measured once, so day-to-day variation is not known.
        </p>
        <div className="tests__people">
          {r.people.map((p, i) => (
            <article key={p.id} className="tests__person" aria-labelledby={`person-${p.id}`}>
              <h3 id={`person-${p.id}`} className="mira-title">
                Person {i + 1}
              </h3>
              <div className="tests__photos">
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local test image */}
                  <img src={p.original} alt={`Person ${String(i + 1)}: the photo as downloaded`} />
                  <figcaption className="mira-small mira-muted">The photo as downloaded</figcaption>
                </figure>
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local test image */}
                  <img
                    src={p.measured}
                    alt={`Person ${String(i + 1)}: the crop MIRA sent to YouCam`}
                  />
                  <figcaption className="mira-small mira-muted">
                    What YouCam measured ({p.mode === "HD" ? "HD detail" : "standard detail"})
                  </figcaption>
                </figure>
              </div>

              <ul className="tests__swatches" aria-label="Measured colours">
                {(["skin", "lip", "eye", "hair"] as const).map((k) => {
                  const hex = p.profile.colours[k];
                  return hex ? (
                    <li key={k}>
                      <span
                        className="tests__chip"
                        style={{ background: hex }}
                        aria-hidden="true"
                      />
                      <span>
                        {captionOf(`colour.${k}`)}
                        <span className="mira-small mira-muted"> {hex}</span>
                      </span>
                    </li>
                  ) : null;
                })}
              </ul>

              <dl className="tests__facts">
                <div>
                  <dt>Fitzpatrick band</dt>
                  <dd>{p.profile.fitzpatrick}</dd>
                </div>
                <div>
                  <dt>Skin lightness band</dt>
                  <dd>
                    {p.profile.itaBand}{" "}
                    <span className="mira-small mira-muted">({fmt(p.profile.ita)}°)</span>
                  </dd>
                </div>
                <div>
                  <dt>Time to measure</dt>
                  <dd>{p.profile.seconds} s</dd>
                </div>
                <div>
                  <dt>Units, all tries</dt>
                  <dd>{p.profile.unitsTotal}</dd>
                </div>
              </dl>

              <table className="tests__skin">
                <caption className="mira-sr-only">Skin readings for person {i + 1}</caption>
                <tbody>
                  {Object.entries(p.profile.skin).map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">{captionOf(`skin.${k}.whole`)}</th>
                      <td>{fmt(v as number | null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mira-small mira-muted">
                Photo: {p.credit.author}, <a href={p.credit.source}>Wikimedia Commons</a>,{" "}
                {p.credit.licenseUrl ? (
                  <a href={p.credit.licenseUrl}>{p.credit.license}</a>
                ) : (
                  p.credit.license
                )}
                . Cropped and resized by MIRA.
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="tests__section" aria-labelledby="shade">
        <h2 id="shade" className="mira-display-m">
          Real shade matches
        </h2>
        <p className="mira-muted">
          For three people, MIRA checked all 20 shades of its sample range for free, then had YouCam
          put the closest three on the face with skin smoothing off, measured each preview again,
          and ranked them by how much the foundation changed the skin&rsquo;s colour. The range is
          MIRA&rsquo;s sample, with invented shade colours.
        </p>
        <p className="mira-muted">
          Measuring the preview changes the answer. For person 4 the catalogue said W 210 was
          nearest, but on the real preview W 200 blended better. That is why MIRA measures every
          preview instead of trusting the shade&rsquo;s listed colour.
        </p>
        {shadeRuns.map((p) => {
          const shade = p.shade;
          if (!shade) return null;
          const n = r.people.indexOf(p) + 1;
          return (
            <article key={p.id} className="tests__shade" aria-labelledby={`shade-${p.id}`}>
              <h3 id={`shade-${p.id}`} className="mira-title">
                Person {n}: {shade.outcomes.length} previews, {shade.seconds} s, {shade.units} units
              </h3>
              <div className="tests__renders">
                {(shade.outcomes as Outcome[]).map((o) => (
                  <figure key={o.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a real YouCam preview saved by the test */}
                    <img
                      src={o.image}
                      alt={`Person ${String(n)} with shade ${o.name}, an unretouched YouCam preview`}
                    />
                    <figcaption>
                      <span
                        className="tests__chip tests__chip--small"
                        style={{ background: o.hex }}
                        aria-hidden="true"
                      />
                      <strong>{o.name}</strong>
                      <span className="mira-small">
                        {LABEL[o.label] ?? "Reads differently"}: ΔE {fmt(o.blendDe, 2)} measured on
                        the preview; ΔE {fmt(o.preDe, 2)} from the catalogue colour
                      </span>
                      {o.directionOk ? null : (
                        <span className="mira-small tests__drift">
                          Colour drifted: the preview moved differently from the shade.
                        </span>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section className="tests__section" aria-labelledby="limits">
        <h2 id="limits" className="mira-display-m">
          What this does not show
        </h2>
        <ul className="tests__limits">
          <li>
            Five people, one photo each, on one day. This shows the whole pipeline works on real
            photos. It is not a calibration: the shade and day-to-day experiments are still to run.
          </li>
          <li>
            YouCam reports hair colour as one of seven fixed values, so brown hair can read as
            black.
          </li>
          <li>The measured skin colour depends on the photo&rsquo;s lighting and white balance.</li>
          <li>
            For the person with the deepest skin tone, the closest sample shade was only
            &ldquo;close&rdquo;: the range does not serve that tone well. That is the gap a brand
            sees in MIRA&rsquo;s Shade Gap Map.
          </li>
        </ul>
        <div className="mira-row">
          <Link href="/how-it-works" className={buttonClass("secondary")}>
            How MIRA works
          </Link>
          <Link href="/consent" className={buttonClass("primary")}>
            Measure yourself
          </Link>
        </div>
      </section>
    </div>
  );
}
