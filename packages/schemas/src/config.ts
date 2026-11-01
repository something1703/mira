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
     * look with a 10-second video (about 30 units) fits several times in a session. The session
     * cap is a deploy setting, `MIRA_SESSION_UNIT_CAP` (packages/schemas/src/env.ts).
     */
    nodeCap: setting(40, "Product choice; the costliest step is a 10 s video", false),
    runCap: setting(120, "Product choice", false),
    /** The live balance is re-read at most this often. */
    balanceCacheSeconds: setting(
      15,
      "Product choice; polls share a 250 / 5 min rate budget",
      false,
    ),
  },
  agent: {
    maxToolDepth: setting(6, "docs/AGENT_RUNTIME.md §1", true),
    contextMessages: setting(10, "docs/AGENT_RUNTIME.md §1", true),
    /** Invalid model output gets one retry, then a templated fallback (AGENTS.md §9). */
    outputRetries: setting(1, "AGENTS.md §9", true),
    segmentMaxChars: setting(400, "docs/AGENT_RUNTIME.md §4", true),
  },
  twin: {
    /**
     * HD skin concerns read when building a profile. Skin Analysis is priced in tiers by concern
     * count (HD: 1-4 = 12, 5-8 = 16, 9-12 = 20 units, read live 2026-11-01), so eight is the most
     * that stays in the 16-unit tier. The set serves the phases that read them: pores, wrinkles,
     * texture, acne, oiliness and redness for Proof (Phase 9); redness and acne for the coverage
     * rule (ENGINES §4.3); dark circles for the concealer pass (Phase 6); skin type for finish.
     * Age spots and eye bags are left out to stay in the tier; Phase 6 can request them as a
     * separate, quoted step.
     */
    skinConcerns: setting(
      [
        "hd_pore",
        "hd_wrinkle",
        "hd_texture",
        "hd_acne",
        "hd_oiliness",
        "hd_redness",
        "hd_dark_circle",
        "hd_skin_type",
      ] as readonly string[],
      "docs/ENGINES.md §4.3, §8; feature-cost tiers (docs/FACTS.md F2)",
      false,
    ),
    /**
     * Face Attributes features read: five stays in the 10-unit tier (1-5 features). They are the
     * ratios identity drift compares (docs/ENGINES.md §7.3) and the proportions the profile shows.
     */
    faceFeatures: setting(
      [
        "faceAspectRatio",
        "horizontalThird",
        "verticalFifth",
        "eyeAspectRatio",
        "noseWidthToMouthWidth",
      ] as readonly string[],
      "docs/ENGINES.md §7.3; feature-cost tiers",
      false,
    ),
    /** Extra face captures taken seconds apart, so s_w can be estimated (docs/ENGINES.md §8, k = 3). */
    repeatCaptures: setting(2, "docs/UX_FLOWS.md §3; docs/ENGINES.md §8 default k = 3", true),
    /** The face must fill more than this share of the photo's width for Skin Analysis. */
    minFaceWidthShare: setting(
      0.6,
      "docs/YOUCAM_API.md §3 (face wider than 60% of the image)",
      true,
    ),
    /**
     * How long a photo that is waiting for a run (the full-body and hand captures, which a later
     * phase reads) is held before MIRA deletes it. A photo a run reads is deleted when that run
     * ends. The bucket's one-day lifecycle rule is the backstop (docs/SECURITY_PRIVACY.md §1).
     */
    heldPhotoMinutes: setting(120, "product choice (D32): the length of one session", true),
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
    /**
     * YouCam allows 250 requests per 300 s per key and per IP (docs/FACTS.md F11). The client
     * stays under it with headroom for other callers sharing the key or the IP.
     */
    requestsPerWindow: setting(200, "docs/FACTS.md F11 (250 per 300 s), minus 20% headroom", false),
    rateWindowSeconds: setting(300, "docs/FACTS.md F11", true),
    /** A call that would have to wait longer than this fails as retryable instead of blocking. */
    rateMaxWaitSeconds: setting(5, "Product choice", false),
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
