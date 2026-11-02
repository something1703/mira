import { z } from "zod";
import { CONFIG } from "./config";
import { PlanId, RunId, SessionId, UserId } from "./ids";
import { Confidence, MetricId } from "./metrics";
import { Quote } from "./plan";

/**
 * The agent's contract (docs/AGENT_RUNTIME.md §3–5). Every tool input and output, the answer the
 * model must produce, and what the panel receives, are schemas here so the model, the services and
 * the screens cannot drift apart.
 */

// ---------------------------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------------------------

export const NextAction = z.enum([
  "match_shade",
  "compose_look",
  "start_proof",
  "proof_check_in",
  "build_twin",
]);
export type NextAction = z.infer<typeof NextAction>;

/**
 * Text has no digits: a reading is written as `{metric.id}` and listed in `metric_refs`, and the
 * renderer fills it from the metric store. The model never types a number.
 */
export const AnswerSegment = z.object({
  text: z.string().min(1).max(CONFIG.agent.segmentMaxChars.value),
  metric_refs: z.array(MetricId).max(12),
});
export type AnswerSegment = z.infer<typeof AnswerSegment>;

export const Answer = z.object({
  segments: z.array(AnswerSegment).min(1).max(8),
  /** Plates to show inline, by the id of the run node that made them. */
  renders: z.array(z.string().min(1).max(80)).max(6),
  next_actions: z.array(NextAction).max(3),
});
export type Answer = z.infer<typeof Answer>;

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

export const TOOL_NAMES = [
  "get_twin_summary",
  "read_product_page",
  "search_catalog",
  "explain_metric",
  "list_look_templates",
  "list_backgrounds",
  "plan_build_twin",
  "plan_match_shade",
  "plan_compose_look",
  "plan_start_proof",
  "plan_proof_check_in",
  "start_run",
] as const;
export const ToolName = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolName>;

/** Tools that only read (docs/AGENT_RUNTIME.md §3). Everything else makes or starts a plan. */
export const READ_TOOLS: readonly ToolName[] = [
  "get_twin_summary",
  "read_product_page",
  "search_catalog",
  "explain_metric",
  "list_look_templates",
  "list_backgrounds",
];

const PublicUrl = z.string().min(1).max(2_000);

export const GetTwinSummaryInput = z.object({}).strict();
export const GetTwinSummaryOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("no_profile") }),
  z.object({
    status: z.literal("ok"),
    /** Metric ids the model may cite, with a short kind so it can tell a number from a colour. */
    metrics: z.array(z.object({ id: MetricId, kind: z.enum(["number", "colour", "category"]) })),
    groups: z.record(z.string(), z.enum(["measured", "partial", "not_measured"])),
    missing: z.array(z.string()),
    synthetic: z.boolean(),
  }),
]);

export const ReadProductPageInput = z.object({ url: PublicUrl });
export const ReadProductPageOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    category: z.enum(["foundation", "lip", "clothing", "skincare", "other"]),
    /** A colour read from the page, as a hex code, when the page gave one. */
    colourHint: z
      .string()
      .regex(/^#[0-9A-F]{6}$/)
      .optional(),
    shades: z.array(z.object({ name: z.string(), hex: z.string() })).max(40),
    claim: z.string().max(300).optional(),
    imageRef: z.string().max(2_000).optional(),
  }),
  z.object({
    status: z.literal("unreadable"),
    reason: z.enum(["unsupported_url", "fetch_failed", "too_large", "no_content", "no_shades"]),
  }),
]);

export type ReadProductPageOutput = z.infer<typeof ReadProductPageOutput>;

export const SearchCatalogInput = z.object({
  query: z.string().min(1).max(200),
  category: z.enum(["foundation", "lip", "clothing"]).optional(),
});
export const SearchCatalogOutput = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        brand: z.string(),
        product: z.string(),
        shadeCount: z.number().int().nonnegative(),
        sample: z.boolean(),
      }),
    )
    .max(20),
});

export const ExplainMetricInput = z.object({ metricId: MetricId });
export const ExplainMetricOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    metricId: MetricId,
    definition: z.string(),
    howMeasured: z.string(),
    /** The same-session spread, when the profile has one for this reading; a metric id to cite. */
    noiseFloorRef: MetricId.optional(),
  }),
  z.object({ status: z.literal("unknown_metric") }),
]);

export const ListLookTemplatesInput = z.object({
  category: z.enum(["makeup", "clothing", "hair"]),
});
export const ListBackgroundsInput = z.object({ venue: z.string().min(1).max(60) });
export const TemplateList = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    items: z.array(z.object({ id: z.string(), name: z.string() })).max(40),
  }),
  z.object({ status: z.literal("unavailable") }),
]);

/** What a plan still needs from the person before it can be quoted. */
export const PlanNeed = z.enum(["photo", "range", "module_unavailable"]);
export type PlanNeed = z.infer<typeof PlanNeed>;

/** A plan as the panel and the model see it. The inputs stay on the server. */
export const PlanView = z.object({
  id: PlanId,
  workflow: z.enum(["build_twin", "match_shade", "compose_look", "proof_setup", "proof_check_in"]),
  /** Short, digit-free description of what would run. */
  summary: z.string().max(200),
  quote: Quote,
  expiresAt: z.iso.datetime(),
  confirmed: z.boolean(),
  runId: RunId.optional(),
});
export type PlanView = z.infer<typeof PlanView>;

export const PlanResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("planned"), plan: PlanView }),
  /** The plan cannot be quoted yet; the screen that collects it is named. */
  z.object({ status: z.literal("needs"), need: PlanNeed, screen: z.string().max(40) }),
  z.object({
    status: z.literal("refused"),
    reason: z.enum([
      "over_cap",
      "price_unavailable",
      "no_profile",
      "nothing_to_run",
      "failed",
      "unknown_range",
    ]),
  }),
]);
export type PlanResult = z.infer<typeof PlanResult>;

export const PlanBuildTwinInput = z.object({
  only: z
    .array(z.enum(["skin", "colouring", "face", "hair"]))
    .max(4)
    .optional(),
});
export const PlanMatchShadeInput = z
  .object({
    rangeId: z.string().min(1).max(80).optional(),
    url: PublicUrl.optional(),
  })
  .refine((v) => (v.rangeId === undefined) !== (v.url === undefined), {
    message: "Give a range id or a product page, not both",
  });
export const PlanComposeLookInput = z.object({
  slots: z.array(z.string().min(1).max(60)).max(6),
});
export const PlanProofInput = z.object({
  product: z.string().min(1).max(120),
  claim: z.string().min(1).max(300).optional(),
});

export const StartRunInput = z.object({ planId: PlanId });
export const StartRunOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("started"), runId: RunId }),
  z.object({
    status: z.literal("refused"),
    reason: z.enum(["not_confirmed", "unknown_plan", "expired", "price_changed", "failed"]),
  }),
]);
export type StartRunOutput = z.infer<typeof StartRunOutput>;

// ---------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------

export const Screen = z.enum([
  "welcome",
  "capture",
  "profile",
  "shade",
  "look",
  "proof",
  "settings",
  "other",
]);
export type Screen = z.infer<typeof Screen>;

export const AskContext = z.object({
  screen: Screen,
  /** Blob key of the face photo the person already uploaded in this session, if any. */
  heldPhoto: z.string().min(1).max(200).optional(),
  /** A run the person is watching, so a question can be about it. */
  activeRunId: RunId.optional(),
});
export type AskContext = z.infer<typeof AskContext>;

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(2_000),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const AskRequest = z.object({
  userId: UserId,
  sessionId: SessionId,
  messages: z.array(ChatMessage).min(1).max(40),
  context: AskContext,
});
export type AskRequest = z.infer<typeof AskRequest>;

/** One rendered sentence, already filled from the metric store. */
export const RenderedSegment = z.object({
  text: z.string(),
  /** The metrics cited, formatted. The panel shows these as readings under the sentence. */
  readings: z.array(
    z.object({
      id: MetricId,
      value: z.string(),
      unit: z.string().optional(),
      confidence: Confidence.optional(),
      words: z.string().optional(),
    }),
  ),
});
export type RenderedSegment = z.infer<typeof RenderedSegment>;

/** Every state UX_FLOWS §9 lists, as the server reports it. */
export const AskResponse = z.object({
  state: z.enum(["answer", "fallback", "plan", "out_of_scope", "unavailable", "needs"]),
  segments: z.array(RenderedSegment),
  nextActions: z.array(NextAction),
  plans: z.array(PlanView),
  needs: z.array(z.object({ need: PlanNeed, screen: z.string() })),
  renders: z.array(z.string()),
  /** The tools the model called, in order. Shown in the run viewer, never as chat text. */
  toolCalls: z.array(z.string()),
  traceId: z.string().optional(),
});
export type AskResponse = z.infer<typeof AskResponse>;
