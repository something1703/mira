import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * The public webhook door, through the real services: mira-web proxies to mira-webhook, which
 * verifies the signature and forwards the task id to mira-workflows (D24). The test server's
 * secret is a throwaway; see playwright.config.ts.
 */
const SECRET = `whsec_${Buffer.from("e2e-only-secret-not-a-real-one").toString("base64")}`;

function signed(id: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key)
    .update(`${id}.${String(timestamp)}.${body}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${sig}`,
  };
}

async function waitForTask(request: APIRequestContext, runId: string): Promise<string> {
  let taskId = "";
  await expect
    .poll(
      async () => {
        const view = (await (await request.get(`/dev/api/runs/${runId}`)).json()) as {
          nodes: { id: string; taskId?: string }[];
        };
        taskId = view.nodes.find((n) => n.id === "tone")?.taskId ?? "";
        return taskId;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");
  return taskId;
}

test.describe("YouCam webhook through the public door", () => {
  test.beforeEach(({ request: _request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "One project exercises the services.");
  });

  test("a correctly signed callback for a real task is accepted, byte for byte", async ({
    request,
  }) => {
    const started = await request.post(`/dev/api/runs?tag=hook-${String(Date.now())}`);
    const { runId } = (await started.json()) as { runId: string };
    const taskId = await waitForTask(request, runId);

    // Odd spacing on purpose: a proxy that re-serialised the JSON would break the signature.
    const body = `{ "created_at": ${String(Math.floor(Date.now() / 1000))},   "data": { "task_id": "${taskId}", "task_status": "success" } }`;
    const res = await request.post("/webhooks/youcam", {
      headers: signed("msg_ok", body),
      data: body,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });
  });

  test("a callback for a task MIRA does not know is acknowledged and ignored", async ({
    request,
  }) => {
    const body = JSON.stringify({
      data: { task_id: "task_nobody_has_made", task_status: "success" },
    });
    const res = await request.post("/webhooks/youcam", {
      headers: signed("msg_unknown", body),
      data: body,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ accepted: false });
  });

  test("a bad or missing signature, a changed body and a stale timestamp are all refused", async ({
    request,
  }) => {
    const body = JSON.stringify({ data: { task_id: "t", task_status: "success" } });
    const good = signed("msg_bad", body);
    const cases: { name: string; headers: Record<string, string>; data: string }[] = [
      { name: "wrong signature", headers: { ...good, "webhook-signature": "v1,AAAA" }, data: body },
      { name: "no signature", headers: { "content-type": "application/json" }, data: body },
      { name: "body changed after signing", headers: good, data: body.replace('"t"', '"u"') },
      {
        name: "timestamp an hour old",
        headers: signed("msg_old", body, Math.floor(Date.now() / 1000) - 3600),
        data: body,
      },
    ];
    for (const c of cases) {
      const res = await request.post("/webhooks/youcam", { headers: c.headers, data: c.data });
      expect(res.status(), c.name).toBe(401);
      expect(await res.json(), c.name).toMatchObject({ error: "invalid_signature" });
    }
  });

  test("a validly signed body that is not a task callback is a 400", async ({ request }) => {
    const body = JSON.stringify({ hello: "world" });
    const res = await request.post("/webhooks/youcam", {
      headers: signed("msg_shape", body),
      data: body,
    });
    expect(res.status()).toBe(400);
  });

  test("the webhook route takes no session cookie and sets none", async ({ request }) => {
    const body = JSON.stringify({ data: { task_id: "x", task_status: "error" } });
    const res = await request.post("/webhooks/youcam", {
      headers: signed("msg_cookie", body),
      data: body,
    });
    expect(res.headers()["set-cookie"]).toBeUndefined();
  });
});
