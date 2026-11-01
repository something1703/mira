import { describe, expect, it } from "vitest";
import { DEFAULT_PORTS, EnvError, loadEnv, PUBLIC_ENV_ALLOWLIST } from "../src/env";

const LIVE_WORKFLOWS = {
  MIRA_MODE: "live",
  YOUCAM_API_KEY: "test-key",
  YOUCAM_API_BASE_URL: "https://example.test",
  YOUCAM_WEBHOOK_SECRET: "s",
  GOOGLE_CLOUD_PROJECT: "p",
  GOOGLE_CLOUD_REGION: "asia-south1",
  GCS_BUCKET_TEMP: "b",
};

describe("loadEnv", () => {
  it("starts every service in mock mode with no credentials", () => {
    for (const service of ["web", "agent", "workflows", "webhook", "engines", "mcp"] as const) {
      const env = loadEnv(service, {});
      expect(env.MIRA_MODE).toBe("mock");
      expect(env.MIRA_MODEL_PROVIDER).toBe("mock");
      expect(env.PORT).toBe(DEFAULT_PORTS[service]);
    }
  });

  it("fails fast in live mode without YOUCAM_API_KEY, naming the variable", () => {
    const { YOUCAM_API_KEY: _omitted, ...rest } = LIVE_WORKFLOWS;
    expect(() => loadEnv("workflows", rest)).toThrow(EnvError);
    expect(() => loadEnv("workflows", rest)).toThrow(/YOUCAM_API_KEY is required in live mode/);
  });

  it("lists every missing variable at once", () => {
    try {
      loadEnv("workflows", { MIRA_MODE: "live" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as EnvError).problems.length).toBe(6);
    }
  });

  it("accepts a complete live environment", () => {
    expect(loadEnv("workflows", LIVE_WORKFLOWS).YOUCAM_API_KEY).toBe("test-key");
  });

  it("treats empty strings as unset", () => {
    expect(() => loadEnv("workflows", { ...LIVE_WORKFLOWS, YOUCAM_API_KEY: "" })).toThrow(
      /YOUCAM_API_KEY/,
    );
  });

  it("rejects NEXT_PUBLIC variables outside the allowlist", () => {
    expect(() => loadEnv("web", { NEXT_PUBLIC_YOUCAM_KEY: "x" })).toThrow(/allowlist/);
    expect(() => loadEnv("web", { NEXT_PUBLIC_MIRA_MODE: "mock" })).not.toThrow();
  });

  it("refuses the mock model provider in live mode", () => {
    expect(() =>
      loadEnv("agent", {
        MIRA_MODE: "live",
        GOOGLE_CLOUD_PROJECT: "p",
        MIRA_MODEL_PROVIDER: "mock",
        MIRA_MODEL_MAIN: "m",
        MIRA_MODEL_SMALL: "s",
        YOUCAM_API_KEY: "k",
      }),
    ).toThrow(/only allowed in mock mode/);
  });

  it("reports malformed values readably", () => {
    expect(() => loadEnv("web", { MIRA_MODE: "staging" })).toThrow(/MIRA_MODE/);
  });
});

describe(".env.example", () => {
  it("documents only allowlisted NEXT_PUBLIC variables and no filled-in secrets", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const text = readFileSync(
      fileURLToPath(new URL("../../../.env.example", import.meta.url)),
      "utf8",
    );
    const assignments = text
      .split("\n")
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => l.split("=") as [string, string]);
    for (const [key] of assignments.filter(([k]) => k.startsWith("NEXT_PUBLIC_"))) {
      expect(PUBLIC_ENV_ALLOWLIST).toContain(key);
    }
    for (const key of ["YOUCAM_API_KEY", "YOUCAM_WEBHOOK_SECRET", "MIRA_SESSION_SECRET"]) {
      expect(assignments.find(([k]) => k === key)?.[1]).toBe("");
    }
  });
});
