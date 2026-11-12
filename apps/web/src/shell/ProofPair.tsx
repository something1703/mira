import Link from "next/link";
import results from "../tests/results.json";

interface Outcome {
  name: string;
  hex: string;
  preDe: number;
  blendDe: number | null;
  verdict: string;
  image: string;
}

/** The person whose catalogue pick and measured best differ most clearly (docs/TESTS.md). */
const PERSON = "t4";

const de = (n: number) => n.toFixed(2);

/**
 * The case for measuring, in one picture: two real, unretouched YouCam previews from the live test.
 * The shade nearest on the catalogue colour against the shade that measured best on the face.
 * Both are picked from the recorded numbers, never typed here; nothing shows if they agree.
 */
export function ProofPair() {
  const index = results.people.findIndex((p) => p.id === PERSON);
  const person = results.people[index];
  const outcomes = (person?.shade?.outcomes ?? []) as Outcome[];
  const verified = outcomes.filter(
    (o): o is Outcome & { blendDe: number } => o.verdict === "verified" && o.blendDe !== null,
  );
  if (!person || verified.length < 2) return null;
  const paper = verified.reduce((a, b) => (b.preDe < a.preDe ? b : a));
  const face = verified.reduce((a, b) => (b.blendDe < a.blendDe ? b : a));
  if (paper === face) return null;
  const n = String(index + 1);

  return (
    <section className="proof-pair" aria-labelledby="proof-pair-title">
      <h2 id="proof-pair-title" className="mira-display-m">
        The closest shade on paper blended worst on the face.
      </h2>
      <p className="lead">
        By eye these two previews look alike. Measured, they are not. That is why MIRA checks every
        preview before you see it.
      </p>
      <div className="proof-pair__grid">
        {[
          {
            o: paper,
            tag: "Closest in the catalogue",
            line: `ΔE ${de(paper.preDe)} from the bottle colour, but ΔE ${de(paper.blendDe)} on the face`,
            best: false,
          },
          {
            o: face,
            tag: "Measured best on the face",
            line: `ΔE ${de(face.preDe)} from the bottle colour, and ΔE ${de(face.blendDe)} on the face`,
            best: true,
          },
        ].map(({ o, tag, line, best }) => (
          <figure key={o.name} className={best ? "is-best" : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a real YouCam preview saved by the test */}
            <img
              src={o.image}
              width={440}
              height={588}
              loading="lazy"
              alt={`Person ${n} with shade ${o.name}, an unretouched YouCam preview`}
            />
            <figcaption>
              <span className="proof-pair__tag mira-small">{tag}</span>
              <span className="proof-pair__name">
                <span
                  className="proof-pair__chip"
                  style={{ background: o.hex }}
                  aria-hidden="true"
                />
                <strong>{o.name}</strong>
              </span>
              <span className="mira-small mira-figures">{line}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mira-small mira-muted">
        Real YouCam previews of person {n} from the live test on {results.date}, with smoothing off.
        Lower ΔE is closer; the lines for a match are starting values, not yet calibrated. Photo:{" "}
        {person.credit.author}, {person.credit.license}.{" "}
        <Link href={`/tests#shade-${person.id}`}>See every number from the test</Link>
      </p>
    </section>
  );
}
