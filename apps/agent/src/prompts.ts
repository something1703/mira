import { readFileSync } from "node:fs";

/**
 * The system prompt, versioned in the file name. It is read once from `prompts/system.v1.md` next
 * to this file (the build copies the folder beside the bundle).
 */
export const SYSTEM_PROMPT_VERSION = "v1";

let cached: string | undefined;
export function systemPrompt(): string {
  cached ??= readFileSync(new URL("./prompts/system.v1.md", import.meta.url), "utf8");
  return cached;
}
