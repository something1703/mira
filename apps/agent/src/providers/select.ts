import type { MiraEnv } from "@mira/schemas/env";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import { AiSdkProvider } from "./ai-sdk";
import { MockProvider, type MockScript } from "./mock";
import type { ModelProvider } from "./types";

export type ProviderEnv = Pick<
  MiraEnv,
  | "MIRA_MODEL_PROVIDER"
  | "MIRA_MODEL_MAIN"
  | "MIRA_MODEL_SMALL"
  | "GOOGLE_CLOUD_PROJECT"
  | "GOOGLE_CLOUD_REGION"
  | "VERTEX_LOCATION"
  | "ANTHROPIC_API_KEY"
>;

/**
 * Builds the adapter `MIRA_MODEL_PROVIDER` names. Nothing outside this file knows which provider
 * is in use: the model ids come from the environment, so moving between the Vertex adapters is a
 * configuration change.
 */
export function selectProvider(env: ProviderEnv, script?: MockScript): ModelProvider {
  const provider = env.MIRA_MODEL_PROVIDER ?? "mock";
  if (provider === "mock") return new MockProvider(script);

  const main = env.MIRA_MODEL_MAIN;
  const small = env.MIRA_MODEL_SMALL ?? main;
  if (!main || !small) throw new Error("MIRA_MODEL_MAIN is required for a real model provider.");
  const location = env.VERTEX_LOCATION ?? env.GOOGLE_CLOUD_REGION;
  const vertex = {
    ...(env.GOOGLE_CLOUD_PROJECT ? { project: env.GOOGLE_CLOUD_PROJECT } : {}),
    ...(location ? { location } : {}),
  };

  switch (provider) {
    case "vertex-google": {
      const v = createVertex(vertex);
      return new AiSdkProvider(provider, { main: v(main), small: v(small) });
    }
    case "vertex-anthropic": {
      const v = createVertexAnthropic(vertex);
      return new AiSdkProvider(provider, { main: v(main), small: v(small) });
    }
    case "anthropic-direct": {
      const a = createAnthropic(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {});
      return new AiSdkProvider(provider, { main: a(main), small: a(small) });
    }
    default:
      throw new Error(`Unknown MIRA_MODEL_PROVIDER: ${String(provider)}`);
  }
}
