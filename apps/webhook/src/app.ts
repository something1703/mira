import {
  Identity,
  createService,
  type CreateServiceOptions,
  type ServiceContext,
} from "@mira/runtime";
import { z } from "zod";
import { verifyWebhook, WebhookPayload } from "./verify";

export interface WebhookDeps {
  /** Injected in tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

const Ack = z.object({ known: z.boolean() });

/**
 * mira-webhook: the public door for YouCam's task callbacks. It verifies the signature and
 * forwards the task id to `mira-workflows`, the only writer of run state (D10). The callback has
 * no result, so workflows still fetches the task itself (docs/YOUCAM_API.md §1.1).
 */
export function buildApp(
  source?: CreateServiceOptions["source"],
  deps: WebhookDeps = {},
): ServiceContext {
  const ctx = createService({ service: "webhook", ...(source ? { source } : {}) });
  const { app, env } = ctx;
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => Date.now());
  const mock = env.MIRA_MODE === "mock";
  const identity = new Identity(deps.fetch ? { fetch: deps.fetch } : {});

  // Signature checks need the exact bytes, so keep the body as a string.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/webhooks/youcam", async (req, reply) => {
    const secret = env.YOUCAM_WEBHOOK_SECRET;
    if (!secret) {
      return await reply
        .status(503)
        .send({ error: "webhook_not_configured", traceId: req.traceId });
    }
    const raw = typeof req.body === "string" ? req.body : "";
    const header = (name: string) => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const verified = verifyWebhook({
      secret,
      id: header("webhook-id"),
      timestamp: header("webhook-timestamp"),
      signature: header("webhook-signature"),
      rawBody: raw,
      nowSec: Math.floor(now() / 1000),
    });
    if (!verified.ok) {
      // One generic answer: do not tell a caller which check failed.
      req.log.warn({ reason: verified.error }, "webhook rejected");
      return await reply.status(401).send({ error: "invalid_signature", traceId: req.traceId });
    }
    let payload: WebhookPayload;
    try {
      payload = WebhookPayload.parse(JSON.parse(raw));
    } catch {
      return await reply.status(400).send({ error: "invalid_payload", traceId: req.traceId });
    }

    try {
      const auth = mock ? {} : await identity.headers(env.MIRA_WORKFLOWS_URL);
      const res = await doFetch(`${env.MIRA_WORKFLOWS_URL}/internal/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mira-trace": req.traceId, ...auth },
        body: JSON.stringify({ taskId: payload.data.task_id, webhookId: verified.value.id }),
      });
      if (!res.ok) throw new Error(`workflows answered ${String(res.status)}`);
      const ack = Ack.parse(await res.json());
      // An unknown task is acknowledged, so YouCam stops retrying a callback we cannot use.
      return await reply.status(200).send({ accepted: ack.known });
    } catch (error) {
      // Nothing was recorded: ask YouCam to retry. `webhook-id` makes the retry idempotent.
      req.log.error({ err: error }, "could not forward webhook");
      return await reply.status(502).send({ error: "forward_failed", traceId: req.traceId });
    }
  });

  return ctx;
}
