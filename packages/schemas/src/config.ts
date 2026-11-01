/**
 * Every TypeScript-side threshold, with where it came from and whether it is calibrated
 * (AGENTS.md §7). Measurement thresholds live in services/engines/mira_engines/config.py.
 * Uncalibrated values are starting points and are never presented as scientific cut-offs.
 */
export interface Setting<T> {
  readonly value: T;
  readonly source: string;
  readonly calibrated: boolean;
}

const setting = <T>(value: T, source: string, calibrated: boolean): Setting<T> => ({
  value,
  source,
  calibrated,
});

export const CONFIG = {
  shade: {
    /** How many pre-ranked shades are rendered by default. */
    renderTopN: setting(3, "docs/ENGINES.md §4.1 default", false),
    /** Upper bound the person can raise it to in the QuoteSheet. */
    renderTopNMax: setting(5, "docs/ENGINES.md §4.1 max", false),
  },
  budget: {
    /** "Session budget low" banner shows below this share of the session cap. */
    lowShare: setting(0.2, "docs/UX_FLOWS.md §0", true),
    /**
     * Unit caps (docs/UX_FLOWS.md §0, "Session budget reached"). Starting values chosen so one
     * look with a 10-second video (about 30 units) fits several times in a session; tune with the
     * demo allowance.
     */
    nodeCap: setting(40, "Product choice; the costliest step is a 10 s video", false),
    runCap: setting(120, "Product choice", false),
    sessionCap: setting(300, "Product choice; tune to the demo allowance", false),
    /** The live balance is re-read at most this often. */
    balanceCacheSeconds: setting(15, "Product choice; polls share a 250 / 5 min rate budget", false),
  },
  agent: {
    maxToolDepth: setting(6, "docs/AGENT_RUNTIME.md §1", true),
    contextMessages: setting(10, "docs/AGENT_RUNTIME.md §1", true),
    /** Invalid model output gets one retry, then a templated fallback (AGENTS.md §9). */
    outputRetries: setting(1, "AGENTS.md §9", true),
    segmentMaxChars: setting(400, "docs/AGENT_RUNTIME.md §4", true),
  },
  plan: {
    /** A quote is honoured for this long; afterwards the plan must be re-quoted. */
    ttlMinutes: setting(
      30,
      "Product choice: feature costs are cached daily, balance changes faster",
      false,
    ),
  },
  youcam: {
    /** Results stay retrievable for 24 hours (docs/FACTS.md F4). */
    resultRetentionHours: setting(24, "docs/FACTS.md F4", true),
    /** Poll backoff for features without webhooks. */
    pollInitialMs: setting(2_000, "Product choice; CASTING measured 16.5–28 s per try-on", false),
    pollMaxMs: setting(15_000, "Product choice", false),
    pollGiveUpMs: setting(10 * 60_000, "Product choice; well inside the 24 h retention", false),
    /** Result URLs work for 2 hours (docs/FACTS.md F4); chained steps stop trusting one 5 minutes early. */
    resultUrlHours: setting(2, "docs/FACTS.md F4", true),
    resultUrlSafetyMinutes: setting(5, "Product choice", false),
    /** A create or poll that fails in a retryable way is retried this many times before the node fails. */
    maxRetries: setting(4, "Product choice", false),
    featureCostCacheHours: setting(24, "phases/PHASE_03 'cost cache refreshed daily'", true),
  },
  retention: {
    imageTtlHours: setting(
      24,
      "docs/DATA_MODEL.md §4 (backstop; images are deleted at run end)",
      true,
    ),
    runsDays: setting(30, "docs/DATA_MODEL.md §4", true),
    cacheDays: setting(7, "docs/DATA_MODEL.md §4", true),
  },
  mock: {
    /** Recorded latencies are scaled down 4× so progress UI is exercised (docs/TESTING.md). */
    latencyScale: setting(0.25, "docs/TESTING.md, Mock mode", true),
  },
} as const;
