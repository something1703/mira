import { describe, expect, it } from "vitest";
import { HttpYouCamApi, parseJsonSafe, type FetchLike } from "../src";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function server(handler: (call: Call) => { status?: number; body?: unknown; text?: string }) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const out = handler(call);
    return Promise.resolve(
      new Response(out.text ?? JSON.stringify(out.body ?? { status: 200 }), {
        status: out.status ?? 200,
      }),
    );
  };
  return {
    calls,
    api: new HttpYouCamApi({ apiKey: "KEY123", baseUrl: "https://api.test", fetch: fetchImpl }),
  };
}

describe("parseJsonSafe", () => {
  it("keeps IDs above 2^53 exact as strings", () => {
    const out = parseJsonSafe('{"results":[{"id":9007199254740993123,"amount_dec":1.5}]}') as {
      results: { id: unknown }[];
    };
    expect(out.results[0]?.id).toBe("9007199254740993123");
  });
});

describe("file upload", () => {
  it("registers, then PUTs with exactly the returned headers and no API key", async () => {
    const { calls, api } = server((c) =>
      c.url.endsWith("/s2s/v2.0/file")
        ? {
            body: {
              status: 200,
              data: {
                files: [
                  {
                    file_id: "file_9",
                    requests: [
                      {
                        method: "PUT",
                        url: "https://s3.test/up/abc",
                        headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
                      },
                    ],
                  },
                ],
              },
            },
          }
        : { status: 200, text: "" },
    );
    const reg = await api.registerFile({
      contentType: "image/jpeg",
      fileName: "a.jpg",
      fileSize: 3,
    });
    expect(reg).toMatchObject({ ok: true, value: { fileId: "file_9" } });
    expect(calls[0]?.headers.Authorization).toBe("Bearer KEY123");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      files: [{ content_type: "image/jpeg", file_name: "a.jpg", file_size: 3 }],
    });
    if (!reg.ok) throw new Error("unreachable");
    expect((await api.putBytes(reg.value, new Uint8Array([1, 2, 3]))).ok).toBe(true);
    const put = calls[1];
    expect(put?.method).toBe("PUT");
    expect(put?.url).toBe("https://s3.test/up/abc");
    expect(put?.headers).toEqual({ "Content-Type": "image/jpeg", "Content-Length": "3" });
    expect(JSON.stringify(calls)).not.toContain("KEY123".repeat(2));
    expect(put?.headers.Authorization).toBeUndefined();
  });

  it("a failed PUT is an error, not silence", async () => {
    const { api } = server(() => ({ status: 403, text: "" }));
    const res = await api.putBytes(
      { fileId: "f", method: "PUT", url: "https://s3.test/x", headers: {} },
      new Uint8Array(),
    );
    expect(res).toMatchObject({
      ok: false,
      error: { kind: "http", code: "upload_failed", status: 403, retryable: true },
    });
  });
});

describe("tasks", () => {
  it("creates at the feature's versioned path and returns the task id", async () => {
    const { calls, api } = server(() => ({ body: { status: 200, data: { task_id: "t1" } } }));
    const res = await api.createTask(
      { slug: "skin-analysis", version: "v2.1" },
      { src_file_id: "f" },
    );
    expect(res).toEqual({ ok: true, value: { taskId: "t1" } });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.test/s2s/v2.1/task/skin-analysis",
    });
  });

  it("polls: running, success with results, error mapped", async () => {
    const states = [
      { data: { task_status: "running" } },
      { data: { task_status: "success", results: { url: "https://r/x.png" } } },
      { data: { task_status: "error", error: "error_src_face_too_small", error_message: "small" } },
    ];
    const { calls, api } = server(() => ({ body: { status: 200, ...states.shift() } }));
    const f = { slug: "makeup-vto", version: "v2.0" } as const;
    expect(await api.getTask(f, "t/1")).toEqual({ ok: true, value: { status: "running" } });
    expect(await api.getTask(f, "t/1")).toEqual({
      ok: true,
      value: { status: "success", results: { url: "https://r/x.png" } },
    });
    const failed = await api.getTask(f, "t/1");
    expect(failed).toMatchObject({
      ok: true,
      value: { status: "error", error: { code: "face_too_small" } },
    });
    expect(calls[0]?.url).toBe("https://api.test/s2s/v2.0/task/makeup-vto/t%2F1");
  });

  it("deletes with the documented POST body", async () => {
    const { calls, api } = server(() => ({ body: { status: 200 } }));
    expect((await api.deleteTask("t1")).ok).toBe(true);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.test/s2s/v2.0/task/delete",
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ task_id: "t1" });
  });

  it("delete of a running task surfaces OperationInvalid", async () => {
    const { api } = server(() => ({
      status: 400,
      body: { status: 400, error_code: "OperationInvalid", error: "task not finished yet" },
    }));
    expect(await api.deleteTask("t1")).toMatchObject({
      ok: false,
      error: { code: "OperationInvalid" },
    });
  });

  it("maps 401, 429 and a malformed body", async () => {
    const f = { slug: "sod", version: "v2.0" } as const;
    expect(
      await server(() => ({ status: 401, body: { error: "Invalid API key" } })).api.createTask(
        f,
        {},
      ),
    ).toMatchObject({
      ok: false,
      error: { kind: "auth" },
    });
    expect(
      await server(() => ({ status: 429, body: { error: "Too many requests" } })).api.getTask(
        f,
        "t",
      ),
    ).toMatchObject({
      ok: false,
      error: { kind: "rate_limited", retryable: true },
    });
    expect(await server(() => ({ body: { data: {} } })).api.createTask(f, {})).toMatchObject({
      ok: false,
      error: { kind: "invalid_response" },
    });
    expect(await server(() => ({ text: "<html>" })).api.createTask(f, {})).toMatchObject({
      ok: false,
      error: { kind: "invalid_response" },
    });
  });

  it("a network failure is retryable and charges nothing", async () => {
    const api = new HttpYouCamApi({
      apiKey: "k",
      baseUrl: "https://api.test",
      fetch: () => Promise.reject(new Error("ECONNRESET")),
    });
    expect(await api.getTask({ slug: "sod", version: "v2.0" }, "t")).toMatchObject({
      ok: false,
      error: { kind: "network", retryable: true, unitsCharged: 0 },
    });
  });
});

describe("credit and feature cost", () => {
  it("sums amount_dec over unexpired entries", async () => {
    const now = 1_000_000;
    const { calls, api } = server(() => ({
      body: {
        status: 200,
        results: [
          { id: 1, type: "ApiSubsToken", amount: 3, amount_dec: 10.5, expiry: now + 1 },
          { id: 2, type: "ApiPaygToken", amount: 9, amount_dec: 4, expiry: now - 1 },
          { id: 3, type: "ApiPaygToken", amount_dec: 2 },
        ],
      },
    }));
    expect(await api.getCredit(now)).toMatchObject({ ok: true, value: { units: 12.5 } });
    expect(calls[0]?.url).toBe("https://api.test/s2s/v1.0/client/credit");
  });

  it("reads every page of feature-cost and maps SKUs to slugs", async () => {
    const pages = [
      {
        next_token: "p2",
        skus: [
          {
            description: "Skin SD 1~4",
            amount: 9,
            unit: "result_image",
            run_task_url: "https://h/s2s/v2.1/task/skin-analysis",
          },
        ],
      },
      {
        next_token: "",
        skus: [
          {
            amount: 4,
            unit: "second",
            run_task_url: "https://h/s2s/v2.0/task/image-to-video/youcam",
          },
        ],
      },
    ];
    const { calls, api } = server(() => ({ body: { status: 200, result: pages.shift() } }));
    const res = await api.getFeatureCosts();
    expect(res).toEqual({
      ok: true,
      value: [
        { description: "Skin SD 1~4", amount: 9, unit: "result_image", slug: "skin-analysis" },
        { amount: 4, unit: "second", slug: "image-to-video/youcam" },
      ],
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/s2s/v2.0/credit/feature-cost?page_size=20",
      "https://api.test/s2s/v2.0/credit/feature-cost?page_size=20&starting_token=p2",
    ]);
  });

  it("stops on a repeated token instead of looping forever", async () => {
    const { calls, api } = server(() => ({
      body: { status: 200, result: { next_token: "same", skus: [] } },
    }));
    expect((await api.getFeatureCosts()).ok).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(2);
  });
});
