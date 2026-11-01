import type { ToolName } from "@mira/schemas";
import type { z } from "zod";

/**
 * The only thing the rest of the agent knows about a model (docs/AGENT_RUNTIME.md §2). An adapter
 * turns these into one provider's calls; switching `MIRA_MODEL_PROVIDER` swaps the adapter and
 * nothing else.
 */
export interface ToolSpec {
  name: ToolName;
  description: string;
  input: z.ZodType;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Unvalidated: the model wrote it. The tool layer parses it with the tool's schema. */
  input: unknown;
}

export type ModelMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; calls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: unknown };

export type Purpose =
  /** The tool loop: the model may call tools or stop. */
  | "step"
  /** The final answer, as the Answer schema. */
  | "answer"
  /** A structured extraction from untrusted text, with the small model. */
  | "extract";

export interface ModelRequest {
  purpose: Purpose;
  system: string;
  messages: ModelMessage[];
  /** Tools the model may call (purpose `step`). */
  tools?: ToolSpec[];
  /** The shape of the reply (purposes `answer` and `extract`). */
  schema?: z.ZodType;
  signal?: AbortSignal;
}

export type ModelReply =
  | { kind: "tools"; text: string; calls: ToolCall[] }
  /** A structured reply the adapter could parse. It is still validated by the caller. */
  | { kind: "object"; value: unknown }
  /** Text the model wrote when asked for structure, so the caller can show it the problem. */
  | { kind: "text"; text: string };

export type ProviderError = { code: "unavailable" | "timeout"; detail: string };

export interface ModelProvider {
  readonly name: string;
  generate(
    req: ModelRequest,
  ): Promise<{ ok: true; value: ModelReply } | { ok: false; error: ProviderError }>;
}
