import { describe, expect, it } from "vitest";
import { newId, TRACE_HEADER } from "@mira/schemas";
import { createService, scrubForLog, UNEXPECTED_ERROR_COPY } from "../src";

describe("createService", () => {
  it("serves /health with the service name and mode", async () => {
    const { app } = createService({ service: "workflows", source: {} });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "mira-workflows", mode: "mock" });
  });

  it("propagates an incoming trace ID and mints one when absent", async () => {
    const { app } = createService({ service: "agent", source: {} });
    const trace = newId("trc");
    const echoed = await app.inject({ url: "/health", headers: { [TRACE_HEADER]: trace } });
    expect(echoed.headers[TRACE_HEADER]).toBe(trace);
    const minted = await app.inject({ url: "/health" });
    expect(minted.headers[TRACE_HEADER]).toMatch(/^trc_[a-z0-9]+$/);
  });

  it("hides internals on unexpected errors and returns the trace ID", async () => {
    const { app } = createService({ service: "agent", source: { LOG_LEVEL: "silent" } });
    app.get("/boom", () => {
      throw new Error("database password is hunter2");
    });
    const res = await app.inject({ url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json<{ message: string; traceId: string }>();
    expect(body.message).toBe(UNEXPECTED_ERROR_COPY);
    expect(body.traceId).toBe(res.headers[TRACE_HEADER]);
    expect(res.body).not.toContain("hunter2");
  });

  it("fails fast in live mode with a readable message", () => {
    expect(() => createService({ service: "workflows", source: { MIRA_MODE: "live" } })).toThrow(
      /YOUCAM_API_KEY is required/,
    );
  });
});

describe("log scrubbing", () => {
  it("redacts secrets, URLs and image payloads", () => {
    const out = scrubForLog({
      authorization: "Bearer k",
      nested: { resultUrl: "https://signed.example/x?sig=1", note: "https://anything" },
      list: ["data:image/png;base64,AAAA", "ok"],
      feature: "skin-analysis",
    });
    expect(out).toEqual({
      authorization: "[redacted]",
      nested: { resultUrl: "[redacted]", note: "[redacted-url]" },
      list: ["[redacted-url]", "ok"],
      feature: "skin-analysis",
    });
  });
});
