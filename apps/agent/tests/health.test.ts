import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("mira-agent", () => {
  it("answers /health in mock mode with no credentials", async () => {
    const { app } = buildApp({});
    const res = await app.inject({ url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "mira-agent", mode: "mock" });
  });
});
