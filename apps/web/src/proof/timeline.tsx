import type { ProofRecord } from "@mira/schemas";

/**
 * The proof timeline (docs/DESIGN_SYSTEM.md §10): the measured concern over time, a band for the
 * person's day-to-day variation around the baseline, a point per session with whiskers for the
 * spread of its captures, and the claim's timeframe as a vertical rule. One accent, for the subject
 * series; everything else is ink. Higher is healthier-looking (YouCam's raw score).
 */
const W = 640;
const H = 300;
const M = { l: 44, r: 16, t: 16, b: 40 };
const DAY = 86_400_000;

const dayOf = (iso: string, zero: number) => (Date.parse(iso) - zero) / DAY;

export function Timeline({ proof }: { proof: ProofRecord }) {
  const first = proof.sessions[0];
  if (!first) return null;
  const zero = Date.parse(first.at);
  const started = proof.startedAt === undefined ? undefined : dayOf(proof.startedAt, zero);
  const ends = started === undefined ? undefined : started + proof.claim.windowDays;
  const baselineSessions = proof.sessions.filter((s) => s.kind === "baseline").slice(0, 3);
  const baseline =
    baselineSessions.length >= 3
      ? baselineSessions.reduce((n, s) => n + s.mean, 0) / baselineSessions.length
      : undefined;
  const mdc = proof.noiseFloor?.mdc ?? undefined;

  const scores = proof.sessions.flatMap((s) => s.scores);
  const lo = Math.min(...scores, ...(baseline !== undefined && mdc ? [baseline - mdc] : []));
  const hi = Math.max(...scores, ...(baseline !== undefined && mdc ? [baseline + mdc] : []));
  const pad = Math.max(2, (hi - lo) * 0.15);
  const y0 = Math.max(1, Math.floor(lo - pad));
  const y1 = Math.min(100, Math.ceil(hi + pad));
  const xMax = Math.max(ends ?? 0, dayOf(proof.sessions.at(-1)?.at ?? proof.createdAt, zero), 1);

  const x = (d: number) => M.l + (d / xMax) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const ticks = [y0, Math.round((y0 + y1) / 2), y1];
  const dayTicks = [0, Math.round(xMax / 2), Math.round(xMax)];

  const points = proof.sessions.map((s) => ({ s, d: dayOf(s.at, zero) }));
  const series = points;
  const path = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)} ${y(p.s.mean).toFixed(1)}`)
    .join(" ");

  const summary = `Timeline of ${String(proof.sessions.length)} sessions of ${proof.claim.concern === "pore" ? "visible pores" : proof.claim.concern}. Higher is healthier-looking.`;

  return (
    <figure className="proof__chart">
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={summary}
        className="proof__svg"
      >
        {baseline !== undefined && mdc ? (
          <g>
            <rect
              x={x(0)}
              y={y(baseline + mdc)}
              width={x(xMax) - x(0)}
              height={Math.max(0, y(baseline - mdc) - y(baseline + mdc))}
              className="proof__band"
              data-testid="noise-band"
            />
            <line
              x1={x(0)}
              x2={x(xMax)}
              y1={y(baseline)}
              y2={y(baseline)}
              className="proof__baseline"
            />
            <text
              x={x(xMax) - 4}
              y={y(baseline + mdc) - 4}
              textAnchor="end"
              className="proof__label"
            >
              Within your day-to-day variation
            </text>
          </g>
        ) : null}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="proof__grid" />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="proof__tick">
              {t}
            </text>
          </g>
        ))}
        {dayTicks.map((d, i) => (
          <text key={i} x={x(d)} y={H - M.b + 18} textAnchor="middle" className="proof__tick">
            {d === 0 ? "Day 0" : `Day ${String(d)}`}
          </text>
        ))}
        {started !== undefined ? (
          <g>
            <line x1={x(started)} x2={x(started)} y1={M.t} y2={H - M.b} className="proof__rule" />
            <text x={x(started) + 4} y={M.t + 12} className="proof__label">
              Started
            </text>
          </g>
        ) : null}
        {ends !== undefined ? (
          <g>
            <line
              x1={x(ends)}
              x2={x(ends)}
              y1={M.t}
              y2={H - M.b}
              className="proof__rule proof__rule--claim"
              data-testid="claim-rule"
            />
            <text x={x(ends) - 4} y={M.t + 12} textAnchor="end" className="proof__label">
              Claim window ends
            </text>
          </g>
        ) : null}
        <path d={path} className="proof__line" fill="none" />
        {points.map(({ s, d }) => (
          <g key={s.runId} data-testid="session">
            <line
              x1={x(d)}
              x2={x(d)}
              y1={y(Math.max(...s.scores))}
              y2={y(Math.min(...s.scores))}
              className="proof__whisker"
            />
            <circle
              cx={x(d)}
              cy={y(s.mean)}
              r={5}
              className={s.kind === "baseline" ? "proof__dot proof__dot--baseline" : "proof__dot"}
            />
          </g>
        ))}
      </svg>
      <figcaption className="mira-small">
        Each point is the mean of three photos; the line through it spans the highest and lowest
        photo. The shaded band is your own day-to-day variation around your baseline.
      </figcaption>
      <table className="mira-sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col">Day</th>
            <th scope="col">Mean score</th>
            <th scope="col">Lowest photo</th>
            <th scope="col">Highest photo</th>
          </tr>
        </thead>
        <tbody>
          {points.map(({ s, d }, i) => (
            <tr key={s.runId}>
              <th scope="row">
                {s.kind === "baseline" ? `Baseline ${String(i + 1)}` : "Check-in"}
              </th>
              <td>{Math.round(d)}</td>
              <td>{s.mean.toFixed(1)}</td>
              <td>{Math.min(...s.scores).toFixed(1)}</td>
              <td>{Math.max(...s.scores).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
