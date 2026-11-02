import type { GapView } from "./api";
import { hueWord } from "./copy";

/**
 * The Shade Gap Map (docs/DESIGN_SYSTEM.md §10): x is hue angle, y is lightness. Each cell is the
 * share of shoppers whose skin colour falls there, drawn darker where there are more; a cell with
 * shoppers no shade serves is hatched and labelled with the share of shoppers it holds. A brand's
 * shades are points in their own colour. One accent; ink for the rest.
 */
const W = 640;
const H = 360;
const M = { l: 48, r: 16, t: 16, b: 44 };
const HUE = [0, 120] as const;
const L = [20, 90] as const;

export function GapMap({ view }: { view: Extract<GapView, { state: "ok" }> }) {
  const x = (h: number) => M.l + ((h - HUE[0]) / (HUE[1] - HUE[0])) * (W - M.l - M.r);
  const y = (l: number) => M.t + (1 - (l - L[0]) / (L[1] - L[0])) * (H - M.t - M.b);
  const maxShare = Math.max(...view.cells.map((c) => c.share), 0.01);
  const gaps = view.cells.filter((c) => c.unservedShare > 0.5);
  const summary = `Shade gap map of ${String(view.shoppers)} shoppers. About ${String(Math.round(view.unservedShare * 100))} percent have no shade within ΔE ${String(view.nearDe)}.`;
  return (
    <figure className="brand__chart">
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={summary}
        className="brand__svg"
      >
        <defs>
          <pattern
            id="hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="brand__hatch" />
          </pattern>
        </defs>
        <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} className="brand__mat" />
        {view.cells.map((c, i) => {
          const w = x(Math.min(HUE[1], c.hueHi)) - x(Math.max(HUE[0], c.hueLo));
          if (c.hueLo >= HUE[1] || w <= 0) return null;
          return (
            <g
              key={i}
              data-testid="gap-cell"
              data-unserved={c.unservedShare > 0.5 ? "true" : "false"}
            >
              <rect
                x={x(Math.max(HUE[0], c.hueLo))}
                y={y(Math.min(L[1], c.lHi))}
                width={w}
                height={y(Math.max(L[0], c.lLo)) - y(Math.min(L[1], c.lHi))}
                className="brand__cell"
                style={{ opacity: 0.15 + 0.7 * (c.share / maxShare) }}
              />
              {c.unservedShare > 0.5 ? (
                <rect
                  x={x(Math.max(HUE[0], c.hueLo))}
                  y={y(Math.min(L[1], c.lHi))}
                  width={w}
                  height={y(Math.max(L[0], c.lLo)) - y(Math.min(L[1], c.lHi))}
                  fill="url(#hatch)"
                />
              ) : null}
            </g>
          );
        })}
        {view.shades.map((s) => (
          <circle
            key={s.id}
            cx={x(Math.min(HUE[1], s.h))}
            cy={y(s.l)}
            r={4.5}
            fill={s.hex}
            className="brand__shade"
          >
            <title>{s.name}</title>
          </circle>
        ))}
        {[0, 30, 60, 90, 120].map((h) => (
          <text key={h} x={x(h)} y={H - M.b + 18} textAnchor="middle" className="brand__tick">
            {h}°
          </text>
        ))}
        {[20, 40, 60, 80].map((l) => (
          <text key={l} x={M.l - 6} y={y(l) + 4} textAnchor="end" className="brand__tick">
            {l}
          </text>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle" className="brand__axis">
          Hue angle of the skin colour
        </text>
        <text
          transform={`translate(12 ${String((M.t + H - M.b) / 2)}) rotate(-90)`}
          textAnchor="middle"
          className="brand__axis"
        >
          Lightness L*
        </text>
      </svg>
      <figcaption className="mira-small">
        Darker cells hold more shoppers. Hatched cells hold shoppers that no shade in your range is
        within ΔE {view.nearDe} of. Dots are your shades, in their own colour.
      </figcaption>
      <div className="mira-sr-only">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">Hue</th>
              <th scope="col">Lightness</th>
              <th scope="col">Share of shoppers</th>
              <th scope="col">Of them, with no shade near</th>
            </tr>
          </thead>
          <tbody>
            {view.cells.map((c, i) => (
              <tr key={i}>
                <th scope="row">
                  {c.hueLo}° to {c.hueHi}° ({hueWord((c.hueLo + c.hueHi) / 2)})
                </th>
                <td>
                  {c.lLo} to {c.lHi}
                </td>
                <td>{Math.round(c.share * 100)}%</td>
                <td>{Math.round(c.unservedShare * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gaps.length > 0 ? (
        <ul className="brand__gaps" aria-label="Skin colours your range does not serve">
          {gaps
            .sort((a, b) => b.share * b.unservedShare - a.share * a.unservedShare)
            .slice(0, 3)
            .map((c, i) => (
              <li key={i}>
                {Math.round(c.share * c.unservedShare * 100)}% of shoppers: lightness {c.lLo} to{" "}
                {c.lHi}, {hueWord((c.hueLo + c.hueHi) / 2)}.
              </li>
            ))}
        </ul>
      ) : null}
    </figure>
  );
}
