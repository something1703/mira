import { pino, type Logger } from "pino";
import type { MiraEnv } from "@mira/schemas/env";

/**
 * Structured logs with the run's trace ID (AGENTS.md §7). Never log images, image URLs, keys or
 * raw prompts with personal data (SECURITY_PRIVACY §6): known-sensitive keys are redacted, and any
 * string that looks like a URL or a data URI is censored wherever it appears in a logged object.
 */
export const REDACT_KEYS = [
  "authorization",
  "apiKey",
  "api_key",
  "YOUCAM_API_KEY",
  "ANTHROPIC_API_KEY",
  "MIRA_SESSION_SECRET",
  "YOUCAM_WEBHOOK_SECRET",
  "secret",
  "token",
  "image",
  "imageBase64",
  "bytes",
  "url",
  "uploadUrl",
  "resultUrl",
  "signedUrl",
  "prompt",
  "messages",
] as const;

const SENSITIVE_STRING = /^(?:https?:\/\/|data:)/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return SENSITIVE_STRING.test(value) ? "[redacted-url]" : value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value !== null && typeof value === "object") {
    if (value instanceof Error)
      return { name: value.name, message: value.message, stack: value.stack };
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        (REDACT_KEYS as readonly string[]).includes(k) ? "[redacted]" : scrub(v, depth + 1),
      ]),
    );
  }
  return value;
}

export function createLogger(env: Pick<MiraEnv, "service" | "LOG_LEVEL" | "MIRA_MODE">): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: `mira-${env.service}`, mode: env.MIRA_MODE },
    // Cloud Logging reads `severity` and `message`.
    messageKey: "message",
    formatters: {
      level: (label) => ({ severity: label.toUpperCase() }),
      log: (object) => scrub(object) as Record<string, unknown>,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
export { scrub as scrubForLog };
