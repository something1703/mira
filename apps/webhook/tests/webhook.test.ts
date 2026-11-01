import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { sign, verifyWebhook } from "../src/verify";

const SECRET = `whsec_${Buffer.from("super-secret-key-bytes").toString("base64")}`;
const NOW = 1_800_000_000;
const body = JSON.stringify({
  created_at: NOW,
  data: { task_id: "task_1", task_status: "success" },
});

const headers = (
  over: Record<string, string> = {},
  raw = body,
  ts = String(NOW),
  id = "msg_1",
) => ({
  "content-type": "application/json",
  "webhook-id": id,
  "webhook-timestamp": ts,
  "webhook-signature": `v1,${sign(SECRET, id, ts, raw) ?? ""}`,
  ...over,
});

describe("verifyWebhook", () => {
  const base = { secret: SECRET, id: "msg_1", timestamp: String(NOW), rawBody: body, nowSec: NOW };
  const good = `v1,${sign(SECRET, "msg_1", String(NOW), body) ?? ""}`;

  it("accepts a correct signature", () => {
    expect(verifyWebhook({ ...base, signature: good })).toEqual({
      ok: true,
      value: { id: "msg_1" },
    });
  });

  it("accepts any matching signature in a rotated header", () => {
    expect(verifyWebhook({ ...base, signature: `v1,AAAA ${good}` }).ok).toBe(true);
    expect(verifyWebhook({ ...base, signature: `v2,${good.slice(3)} ${good}` }).ok).toBe(true);
  });

  it("rejects a changed body, id, timestamp or secret", () => {
    expect(verifyWebhook({ ...base, signature: good, rawBody: `${body} ` })).toEqual({
      ok: false,
      error: "bad_signature",
    });
    expect(verifyWebhook({ ...base, signature: good, id: "msg_2" })).toEqual({
      ok: false,
      error: "bad_signature",
    });
    expect(verifyWebhook({ ...base, signature: good, timestamp: String(NOW + 1) }).ok).toBe(false);
    const other = `whsec_${Buffer.from("different").toString("base64")}`;
    expect(verifyWebhook({ ...base, signature: good, secret: other })).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("rejects stale and future timestamps, but not ones inside the tolerance", () => {
    const at = (t: number) => {
      const ts = String(t);
      return verifyWebhook({
        ...base,
        timestamp: ts,
        signature: `v1,${sign(SECRET, "msg_1", ts, body) ?? ""}`,
      });
    };
    expect(at(NOW - 301)).toEqual({ ok: false, error: "stale_timestamp" });
    expect(at(NOW + 301)).toEqual({ ok: false, error: "stale_timestamp" });
    expect(at(NOW - 299).ok).toBe(true);
  });

  it("rejects missing headers, a non-whsec secret and a non-numeric timestamp", () => {
    expect(verifyWebhook({ ...base, signature: undefined })).toEqual({
      ok: false,
      error: "missing_headers",
    });
    expect(verifyWebhook({ ...base, id: undefined, signature: good })).toEqual({
      ok: false,
      error: "missing_headers",
    });
    expect(verifyWebhook({ ...base, signature: good, secret: "plain" })).toEqual({
      ok: false,
      error: "bad_secret",
    });
    expect(verifyWebhook({ ...base, signature: good, timestamp: "soon" }).ok).toBe(false);
  });

  it("matches the Standard Webhooks reference vector", () => {
    // From the Standard Webhooks specification's example (secret, id, timestamp, payload).
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const payload = '{"test": 2432232314}';
    expect(sign(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", "1614265330", payload)).toBe(
      "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    );
  });
});

describe("POST /webhooks/youcam", () => {
  const env = { YOUCAM_WEBHOOK_SECRET: SECRET };
  const forwarder = (answer: { status?: number; body?: unknown } | Error) => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(
        new Response(JSON.stringify(answer.body ?? { known: true }), {
          status: answer.status ?? 200,
        }),
      );
    }) as typeof fetch;
    return { calls, fetchImpl };
  };
  const post = async (
    app: ReturnType<typeof buildApp>["app"],
    h: Record<string, string>,
    payload = body,
  ) => await app.inject({ method: "POST", url: "/webhooks/youcam", headers: h, payload });

  it("verifies, then forwards only the task id and webhook id to workflows", async () => {
    const f = forwarder({});
    const { app } = buildApp(env, { fetch: f.fetchImpl, now: () => NOW * 1000 });
    const res = await post(app, headers());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: true });
    expect(f.calls).toEqual([
      {
        url: "http://localhost:4020/internal/webhook",
        body: { taskId: "task_1", webhookId: "msg_1" },
      },
    ]);
  });

  it("answers 401 without forwarding for a bad signature, and never says which check failed", async () => {
    const f = forwarder({});
    const { app } = buildApp(env, { fetch: f.fetchImpl, now: () => NOW * 1000 });
    for (const h of [
      headers({ "webhook-signature": "v1,AAAA" }),
      headers({}, body, String(NOW - 4000)),
      headers({ "webhook-id": "" }),
    ]) {
      const res = await post(app, h);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: "invalid_signature" });
    }
    expect(f.calls).toHaveLength(0);
  });

  it("acknowledges a task workflows does not know, so YouCam stops retrying", async () => {
    const { app } = buildApp(env, {
      fetch: forwarder({ body: { known: false } }).fetchImpl,
      now: () => NOW * 1000,
    });
    const res = await post(app, headers());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: false });
  });

  it("answers 502 when workflows is unreachable or errors, so YouCam retries", async () => {
    for (const answer of [new Error("ECONNREFUSED"), { status: 500 }]) {
      const { app } = buildApp(env, { fetch: forwarder(answer).fetchImpl, now: () => NOW * 1000 });
      expect((await post(app, headers())).statusCode).toBe(502);
    }
  });

  it("rejects a valid signature over a payload that is not a task callback", async () => {
    const raw = JSON.stringify({ hello: "world" });
    const { app } = buildApp(env, { fetch: forwarder({}).fetchImpl, now: () => NOW * 1000 });
    expect((await post(app, headers({}, raw), raw)).statusCode).toBe(400);
  });

  it("is not configured without a secret", async () => {
    const { app } = buildApp({}, { fetch: forwarder({}).fetchImpl });
    expect((await post(app, headers())).statusCode).toBe(503);
  });
});
