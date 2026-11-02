import { z } from "zod";

/**
 * Environment loader. Every service validates its environment at start-up and fails fast with a
 * readable message. In mock mode no secret is required (AGENTS.md §2.11).
 */

export const MiraMode = z.enum(["mock", "live"]);
export type MiraMode = z.infer<typeof MiraMode>;

export const ServiceName = z.enum(["web", "agent", "workflows", "webhook", "engines", "mcp"]);
export type ServiceName = z.infer<typeof ServiceName>;

export const ModelProvider = z.enum([
  "vertex-anthropic",
  "vertex-google",
  "anthropic-direct",
  "mock",
]);
export type ModelProvider = z.infer<typeof ModelProvider>;

/** Local ports, one per service, used in mock and dev. */
export const DEFAULT_PORTS: Record<ServiceName, number> = {
  web: 3000,
  agent: 4010,
  workflows: 4020,
  webhook: 4030,
  engines: 4040,
  mcp: 4050,
};

/** The only NEXT_PUBLIC_* variables allowed; none may hold a secret (SECURITY_PRIVACY §2). */
export const PUBLIC_ENV_ALLOWLIST = ["NEXT_PUBLIC_MIRA_MODE"] as const;

const intFromEnv = (fallback: number) => z.coerce.number().int().nonnegative().default(fallback);
const optionalString = z.string().min(1).optional();

const Common = z.object({
  MIRA_MODE: MiraMode.default("mock"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),
  PORT: z.coerce.number().int().positive().optional(),
  /** Local state (mock store, blobs) lives here; never committed. */
  MIRA_STATE_DIR: z.string().default(".mira"),
  /**
   * `live` sends photos to the real YouCam API while everything else stays local (file-backed
   * state, in-process queue). For testing that MIRA really measures, before a cloud deploy.
   * Real units are spent, behind the same quotes and caps. Only meaningful in mock mode.
   */
  MIRA_YOUCAM: z.enum(["fake", "live"]).default("fake"),

  MIRA_WEB_URL: z.url().default(`http://localhost:${DEFAULT_PORTS.web}`),
  MIRA_AGENT_URL: z.url().default(`http://localhost:${DEFAULT_PORTS.agent}`),
  MIRA_WORKFLOWS_URL: z.url().default(`http://localhost:${DEFAULT_PORTS.workflows}`),
  MIRA_WEBHOOK_URL: z.url().default(`http://localhost:${DEFAULT_PORTS.webhook}`),
  MIRA_ENGINES_URL: z.url().default(`http://localhost:${DEFAULT_PORTS.engines}`),

  /** Unit caps (product choices for the demo; see docs/DECISIONS.md). */
  MIRA_NODE_UNIT_CAP: intFromEnv(60),
  MIRA_RUN_UNIT_CAP: intFromEnv(120),
  MIRA_SESSION_UNIT_CAP: intFromEnv(200),
  /**
   * Units the whole deployment may spend in one UTC day, whoever asks. A session cap alone can be
   * reset by clearing cookies, so this is the cap a script cannot get around (D35). Live default;
   * mock mode applies it only when set.
   */
  MIRA_DEPLOYMENT_DAILY_UNIT_CAP: intFromEnv(400),
  /** Minimum cohort before any brand aggregate is shown (DATA_MODEL §3). */
  MIRA_K_ANON_MIN: intFromEnv(20),

  GOOGLE_CLOUD_PROJECT: optionalString,
  GOOGLE_CLOUD_REGION: optionalString,
  /** Set only when pointing live code at the Firestore emulator. */
  FIRESTORE_EMULATOR_HOST: optionalString,
});

/** Variables each service needs in live mode. Mock mode needs none of them. */
const LIVE_REQUIREMENTS: Record<ServiceName, readonly string[]> = {
  web: ["MIRA_SESSION_SECRET", "GOOGLE_CLOUD_PROJECT"],
  agent: [
    "GOOGLE_CLOUD_PROJECT",
    "MIRA_MODEL_PROVIDER",
    "MIRA_MODEL_MAIN",
    "MIRA_MODEL_SMALL",
    "YOUCAM_API_KEY",
  ],
  workflows: [
    "YOUCAM_API_KEY",
    "YOUCAM_API_BASE_URL",
    "YOUCAM_WEBHOOK_SECRET",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_REGION",
    "GCS_BUCKET_TEMP",
  ],
  webhook: ["YOUCAM_WEBHOOK_SECRET", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_REGION"],
  engines: [],
  mcp: ["MIRA_MCP_TOKENS", "GOOGLE_CLOUD_PROJECT"],
};

const Secrets = z.object({
  YOUCAM_API_KEY: optionalString,
  YOUCAM_API_BASE_URL: z.url().optional(),
  YOUCAM_WEBHOOK_SECRET: optionalString,
  MIRA_SESSION_SECRET: optionalString,
  MIRA_MCP_TOKENS: optionalString,
  GCS_BUCKET_TEMP: optionalString,
  MIRA_MODEL_PROVIDER: ModelProvider.optional(),
  MIRA_MODEL_MAIN: optionalString,
  MIRA_MODEL_SMALL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  VERTEX_LOCATION: optionalString,
});

export const MiraEnv = Common.extend(Secrets.shape);
export type MiraEnv = z.infer<typeof MiraEnv> & { readonly service: ServiceName };

export class EnvError extends Error {
  constructor(
    readonly service: ServiceName,
    readonly problems: readonly string[],
  ) {
    super(
      [
        `mira-${service} cannot start: the environment is incomplete.`,
        ...problems.map((p) => `  • ${p}`),
        "Copy .env.example to .env.local and fill these in, or run `pnpm dev:mock` to use recorded runs with no credentials.",
      ].join("\n"),
    );
    this.name = "EnvError";
  }
}

/** Validates the environment for one service. Throws EnvError with every problem at once. */
export function loadEnv(
  service: ServiceName,
  source: Record<string, string | undefined> = process.env,
): MiraEnv {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = MiraEnv.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvError(
      service,
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const env = parsed.data;
  const problems: string[] = [];

  const unknownPublic = Object.keys(cleaned).filter(
    (k) => k.startsWith("NEXT_PUBLIC_") && !(PUBLIC_ENV_ALLOWLIST as readonly string[]).includes(k),
  );
  for (const key of unknownPublic) {
    problems.push(
      `${key} is not in the NEXT_PUBLIC allowlist; browser-visible variables must never hold secrets.`,
    );
  }

  if (env.MIRA_YOUCAM === "live" && service === "workflows" && !("YOUCAM_API_KEY" in cleaned)) {
    problems.push("YOUCAM_API_KEY is required when MIRA_YOUCAM=live (put it in .env.local).");
  }

  if (env.MIRA_MODE === "live") {
    for (const key of LIVE_REQUIREMENTS[service]) {
      if (!(key in cleaned)) problems.push(`${key} is required in live mode.`);
    }
    if (env.MIRA_MODEL_PROVIDER === "mock") {
      problems.push("MIRA_MODEL_PROVIDER=mock is only allowed in mock mode.");
    }
    if (env.MIRA_MODEL_PROVIDER === "anthropic-direct" && !env.ANTHROPIC_API_KEY) {
      problems.push("ANTHROPIC_API_KEY is required when MIRA_MODEL_PROVIDER=anthropic-direct.");
    }
  }

  if (problems.length > 0) throw new EnvError(service, problems);

  return {
    ...env,
    // Mock mode always uses the recorded model stub, whatever is set.
    MIRA_MODEL_PROVIDER: env.MIRA_MODE === "mock" ? "mock" : env.MIRA_MODEL_PROVIDER,
    PORT: env.PORT ?? DEFAULT_PORTS[service],
    service,
  };
}
