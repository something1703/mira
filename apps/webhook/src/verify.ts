import { createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, type Result } from "@mira/schemas";
import { z } from "zod";

/**
 * Standard Webhooks verification (docs/YOUCAM_API.md §1.1, D13). YouCam signs
 * `{webhook-id}.{webhook-timestamp}.{raw body}` with HMAC-SHA256 under a `whsec_` secret and sends
 * `webhook-signature: v1,<base64>`. The raw body must be the bytes received, not re-serialised JSON.
 */
export type VerifyError = "missing_headers" | "bad_secret" | "stale_timestamp" | "bad_signature";

export const WebhookPayload = z.object({
  created_at: z.number().optional(),
  data: z.object({
    task_id: z.string().min(1),
    task_status: z.enum(["success", "error"]),
  }),
});
export type WebhookPayload = z.infer<typeof WebhookPayload>;

export interface VerifyInput {
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  /** Seconds since the epoch. */
  nowSec: number;
  /** How far the timestamp may be from now, either way. Default 5 minutes. */
  toleranceSec?: number;
}

export function sign(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
): string | undefined {
  if (!secret.startsWith("whsec_")) return undefined;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  if (key.length === 0) return undefined;
  return createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
}

export function verifyWebhook(i: VerifyInput): Result<{ id: string }, VerifyError> {
  if (!i.id || !i.timestamp || !i.signature) return err("missing_headers");
  const expected = sign(i.secret, i.id, i.timestamp, i.rawBody);
  if (expected === undefined) return err("bad_secret");
  const ts = Number(i.timestamp);
  if (!Number.isFinite(ts) || Math.abs(i.nowSec - ts) > (i.toleranceSec ?? 300))
    return err("stale_timestamp");
  const want = Buffer.from(expected);
  // The header can carry several space-separated signatures (key rotation); any `v1` match passes.
  for (const part of i.signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || value === undefined) continue;
    const got = Buffer.from(value);
    if (got.length === want.length && timingSafeEqual(got, want)) return ok({ id: i.id });
  }
  return err("bad_signature");
}
