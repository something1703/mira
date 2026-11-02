/**
 * The MIRA lockup (docs/BRAND.md): the mark (a mirror with a calibration scale and one accent
 * reading) beside the monoline wordmark. Drawn inline so it follows the theme's ink and accent.
 * Geometry is copied from assets/brand/mira-lockup.svg.
 */
export function Lockup({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 344 96" role="img" aria-label="MIRA" className={className}>
      <circle cx="48" cy="48" r="28" fill="none" stroke="var(--mira-ink)" strokeWidth="6" />
      <g strokeWidth="3.5" strokeLinecap="round" stroke="var(--mira-ink)">
        <line x1="57.50" y1="31.55" x2="59.50" y2="28.08" />
        <line x1="62.55" y1="35.79" x2="65.62" y2="33.21" />
        <line x1="67.00" y1="48.00" x2="71.00" y2="48.00" />
        <line x1="65.85" y1="54.50" x2="69.61" y2="55.87" />
        <line x1="62.55" y1="60.21" x2="65.62" y2="62.79" />
        <line x1="57.50" y1="64.45" x2="59.50" y2="67.92" />
      </g>
      <line
        x1="58.34"
        y1="44.24"
        x2="69.61"
        y2="40.13"
        stroke="var(--mira-accent)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <g transform="translate(120,2)">
        <g
          fill="none"
          stroke="var(--mira-ink)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 80V32M10 47a15 15 0 0 1 30 0V80M40 47a15 15 0 0 1 30 0V80" />
          <path d="M90 32V80" />
          <path d="M112 80V32M112 54Q112 32 136 32" />
          <circle cx="176" cy="56" r="24" />
          <path d="M200 32V80" />
        </g>
        <circle cx="90" cy="13" r="6.5" fill="var(--mira-accent)" />
      </g>
    </svg>
  );
}
