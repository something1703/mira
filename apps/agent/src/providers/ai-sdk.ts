import { err, ok } from "@mira/schemas";
import {
  NoObjectGeneratedError,
  Output,
  generateText,
  tool,
  type LanguageModel,
  type ModelMessage as SdkMessage,
  type ToolSet,
} from "ai";
import type {
  ModelMessage,
  ModelProvider,
  ModelReply,
  ModelRequest,
  ProviderError,
  ToolSpec,
} from "./types";

/**
 * One adapter over the Vercel AI SDK, for every real provider (Vertex Gemini, Vertex Anthropic,
 * Anthropic direct). The loop, the tools and the confirmation guard are MIRA's own: this makes one
 * model call at a time and hands back the tool calls without running them (no `execute`), so a
 * provider can never run a tool the loop did not approve.
 */
export interface AiSdkModels {
  /** The main loop and the answer. */
  main: LanguageModel;
  /** Extraction from untrusted pages. */
  small: LanguageModel;
}

function toSdkMessages(messages: readonly ModelMessage[]): SdkMessage[] {
  return messages.map((m): SdkMessage => {
    if (m.role === "user") return { role: "user", content: m.text };
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: [
          ...(m.text ? [{ type: "text" as const, text: m.text }] : []),
          ...(m.calls ?? []).map((c) => ({
            type: "tool-call" as const,
            toolCallId: c.id,
            toolName: c.name,
            input: c.input,
          })),
        ],
      };
    }
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: m.callId,
          toolName: m.name,
          output: { type: "json", value: m.result as never },
        },
      ],
    };
  });
}

// No `execute`: the SDK reports the model's calls and never runs one (see the class comment).
const toolSet = (specs: readonly ToolSpec[]): ToolSet =>
  Object.fromEntries(
    specs.map((s) => [s.name, tool({ description: s.description, inputSchema: s.input })]),
  ) as unknown as ToolSet;

export class AiSdkProvider implements ModelProvider {
  constructor(
    readonly name: string,
    private readonly models: AiSdkModels,
  ) {}

  async generate(
    req: ModelRequest,
  ): Promise<{ ok: true; value: ModelReply } | { ok: false; error: ProviderError }> {
    const model = req.purpose === "extract" ? this.models.small : this.models.main;
    const common = {
      model,
      system: req.system,
      messages: toSdkMessages(req.messages),
      ...(req.signal ? { abortSignal: req.signal } : {}),
      // The caller owns retries (CONFIG.agent.outputRetries); the SDK's own would double them.
      maxRetries: 1,
    };
    try {
      if (req.purpose === "step") {
        const r = await generateText({ ...common, tools: toolSet(req.tools ?? []) });
        return ok({
          kind: "tools",
          text: r.text,
          calls: r.toolCalls.map((c) => ({
            id: c.toolCallId,
            name: c.toolName,
            input: c.input as unknown,
          })),
        });
      }
      if (!req.schema) return err({ code: "unavailable", detail: "A schema is required." });
      const r = await generateText({ ...common, output: Output.object({ schema: req.schema }) });
      return ok({ kind: "object", value: r.output });
    } catch (e) {
      // The model answered, but not in the shape asked for: the caller shows it the problem.
      if (NoObjectGeneratedError.isInstance(e) && typeof e.text === "string") {
        return ok({ kind: "text", text: e.text });
      }
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return err({
        code: timeout ? "timeout" : "unavailable",
        detail: e instanceof Error ? e.message.slice(0, 200) : "model call failed",
      });
    }
  }
}
