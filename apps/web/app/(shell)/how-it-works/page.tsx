import { buttonClass } from "@mira/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How MIRA works" };

type Status = "live" | "sample";

const STATUS_WORDS: Record<Status, string> = {
  live: "Tested on real photos",
  sample: "Built; runs on sample data so far",
};

const MODULES: { name: string; href: string; what: string; youcam: string; status: Status }[] = [
  {
    name: "Measured profile",
    href: "/capture",
    what: "One photo becomes a list of numbers: skin readings, skin, lip, eye and hair colour, a skin lightness band and face proportions. The photo is deleted; the numbers stay until you delete them.",
    youcam: "Skin Analysis, Facial Color Tones, Fitzpatrick, Face Attributes",
    status: "live",
  },
  {
    name: "Shade match",
    href: "/shade",
    what: "Checks every foundation shade in a range against your measured skin for free, has YouCam put the closest three on your face with skin smoothing off, measures each preview again and ranks them by how well they actually blend.",
    youcam: "Makeup VTO (unretouched), Facial Color Tones",
    status: "live",
  },
  {
    name: "Complete look",
    href: "/look",
    what: "Clothes, shoes, bag, makeup chosen for the outfit and hair, as one look, checked step by step: garment colour, lip colour, and whether your face changed. A step that changes your face is not shown.",
    youcam: "Clothes, bag and shoe try-on, Makeup VTO, hair colour, background, image-to-video",
    status: "sample",
  },
  {
    name: "Event mode",
    href: "/event",
    what: "Plans a look for each function of a multi-day event, such as haldi, mehendi, sangeet and the wedding, on one board.",
    youcam: "Everything Complete look uses",
    status: "sample",
  },
  {
    name: "Progress check",
    href: "/proof",
    what: "Tells you whether a skincare product's visible claim shows up in your photos, only when the change is bigger than how much your own readings move from day to day.",
    youcam: "Skin Analysis, Skin Simulation",
    status: "sample",
  },
  {
    name: "Ask MIRA",
    href: "/",
    what: "An assistant that explains readings and plans runs. It never types a number itself and never starts a paid run without your confirmation.",
    youcam: "Plans the runs above; YouCam MCP for template lists",
    status: "sample",
  },
  {
    name: "For brands",
    href: "/brand",
    what: "Shows a brand which measured skin tones its range does not serve, from people who chose to share anonymous readings, in groups of at least twenty.",
    youcam: "Built from the readings above",
    status: "sample",
  },
];

/** The plain explanation of what MIRA is, what each part does, and what is real today. */
export default function HowItWorks() {
  return (
    <div className="how">
      <header>
        <h1 className="mira-display-l">How MIRA works</h1>
        <p className="lead">
          Virtual try-on previews usually smooth your skin and nobody checks whether they show the
          right colour. MIRA uses Perfect Corp&rsquo;s YouCam API to measure you once, show makeup
          and clothes on you without smoothing, and measure every preview again before you see it.
        </p>
      </header>

      <section aria-labelledby="loop">
        <h2 id="loop" className="mira-display-m">
          One loop behind everything
        </h2>
        <ol className="how__loop">
          <li>
            <strong>Measure.</strong> YouCam analyses your photo. MIRA keeps the numbers and deletes
            the photo.
          </li>
          <li>
            <strong>Decide.</strong> MIRA&rsquo;s own maths picks what to try, for free: the closest
            shades, a lip colour for the outfit.
          </li>
          <li>
            <strong>Render.</strong> YouCam puts it on your photo, with skin smoothing off.
          </li>
          <li>
            <strong>Verify.</strong> MIRA measures the preview again and labels it: verified, colour
            drifted, or withheld if your face changed.
          </li>
        </ol>
        <p className="mira-muted">
          Every paid step shows its price in YouCam units first and runs only when you confirm. A
          step that fails costs nothing.
        </p>
      </section>

      <section aria-labelledby="parts">
        <h2 id="parts" className="mira-display-m">
          The parts, and what is real today
        </h2>
        <ul className="how__modules">
          {MODULES.map((m) => (
            <li key={m.name} className="how__module">
              <div className="how__module-head">
                <h3 className="mira-title">
                  <Link href={m.href as "/"}>{m.name}</Link>
                </h3>
                <span className={`how__status how__status--${m.status}`}>
                  {STATUS_WORDS[m.status]}
                </span>
              </div>
              <p>{m.what}</p>
              <p className="mira-small mira-muted">YouCam: {m.youcam}</p>
            </li>
          ))}
        </ul>
        <div className="mira-row">
          <Link href="/tests" className={buttonClass("primary")}>
            See the real test results
          </Link>
        </div>
      </section>

      <section aria-labelledby="modes">
        <h2 id="modes" className="mira-display-m">
          Two ways to run it
        </h2>
        <dl className="how__modes">
          <div>
            <dt className="mira-title">Sample mode</dt>
            <dd>
              Needs no account and spends nothing. Every screen works, but the results are the same
              sample numbers whatever photo you use, and every screen says so.
            </dd>
          </div>
          <div>
            <dt className="mira-title">Live measuring</dt>
            <dd>
              Your photos go to YouCam and the readings are really yours. Each run spends YouCam
              units after you confirm its price. A banner at the top says which mode you are in.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
