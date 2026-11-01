import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function upstream(status = 200, body = "{}") {
  const seen: { url: string; method: string; headers: Headers; body: string | undefined }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    seen.push({
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: init.body as string | undefined,
    });
    return Promise.resolve(
      new Response(body, {
        status,
        headers: {
          "content-type": "application/json",
          "set-cookie": "leak=1",
          "x-internal": "secret",
        },
      }),
    );
  }) as typeof fetch;
  return { seen, fetchImpl };
}

describe("proxy", () => {
  it("forwards the webhook body byte for byte with only the signature headers", async () => {
    const { seen, fetchImpl } = upstream(200, '{"accepted":true}');
    const raw = '{ "created_at":1,   "data": {"task_id":"t","task_status":"success"} }'; // odd spacing on purpose
    const res = await proxy(
      new Request("https://mira.test/webhooks/youcam", {
        method: "POST",
        body: raw,
        headers: {
          "content-type": "application/json",
          "webhook-id": "msg_1",
          "webhook-timestamp": "1800000000",
          "webhook-signature": "v1,abc",
          cookie: "session=secret",
          authorization: "Bearer should-not-pass",
        },
      }),
      {
        target: "http://webhook:4030",
        path: "/webhooks/youcam",
        forward: ["content-type", "webhook-id", "webhook-timestamp", "webhook-signature"],
        fetch: fetchImpl,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });
    expect(seen[0]?.url).toBe("http://webhook:4030/webhooks/youcam");
    expect(seen[0]?.body).toBe(raw);
    expect([...(seen[0]?.headers.keys() ?? [])].sort()).toEqual([
      "content-type",
      "webhook-id",
      "webhook-signature",
      "webhook-timestamp",
    ]);
  });

  it("passes the upstream status and drops internal response headers", async () => {
    const { fetchImpl } = upstream(401, '{"error":"invalid_signature"}');
    const res = await proxy(new Request("https://mira.test/x", { method: "POST", body: "{}" }), {
      target: "http://t",
      path: "/p",
      forward: [],
      fetch: fetchImpl,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-internal")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("GET carries no body, and the MCP token header is forwarded when listed", async () => {
    const { seen, fetchImpl } = upstream();
    await proxy(
      new Request("https://mira.test/mcp/x", {
        headers: { authorization: "Bearer tok", "mcp-session-id": "s1" },
      }),
      {
        target: "http://mcp:4050",
        path: "/mcp/x",
        forward: ["authorization", "mcp-session-id"],
        fetch: fetchImpl,
      },
    );
    expect(seen[0]?.body).toBeUndefined();
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok");
  });

  it("answers 502 without leaking when the service is down", async () => {
    const res = await proxy(new Request("https://mira.test/x", { method: "POST", body: "{}" }), {
      target: "http://t",
      path: "/p",
      forward: [],
      fetch: () => Promise.reject(new Error("ECONNREFUSED 10.0.0.7:4030")),
    });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.7");
  });
});
